package io.starring.guardian;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import org.json.JSONException;
import org.json.JSONObject;

/** A small offline shell; every game resource ships inside the APK. */
public final class MainActivity extends Activity {
    private WebView gameView;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.rgb(7, 16, 20));
        getWindow().setNavigationBarColor(Color.rgb(7, 16, 20));
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;
            getWindow().setAttributes(attributes);
        }

        gameView = new WebView(this);
        gameView.setBackgroundColor(Color.rgb(7, 16, 20));
        gameView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = gameView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false); // android_asset remains accessible.
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        gameView.addJavascriptInterface(new SaveStore(), "AndroidStore");
        gameView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isPackagedResource(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isPackagedResource(Uri.parse(url));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return isPackagedResource(request.getUrl()) ? null : blockedResponse();
            }
        });
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(7, 16, 20));
        container.addView(gameView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        // Android 11+ (including enforced edge-to-edge on Android 15) explicitly
        // reserves system bars, cutouts and the keyboard. Older versions use
        // the platform's normal non-fullscreen adjustResize behavior.
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            container.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override public WindowInsets onApplyWindowInsets(View view, WindowInsets windowInsets) {
                    Insets space = windowInsets.getInsets(WindowInsets.Type.systemBars() |
                        WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                    view.setPadding(space.left, space.top, space.right, space.bottom);
                    return WindowInsets.CONSUMED;
                }
            });
        }
        setContentView(container);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        container.requestApplyInsets();
        gameView.loadUrl("file:///android_asset/index.html");
    }

    private static boolean isPackagedResource(Uri uri) {
        String path = uri.getPath();
        return "file".equals(uri.getScheme()) && path != null &&
            path.startsWith("/android_asset/") && !path.contains("/../") &&
            !path.endsWith("/..") && (uri.getHost() == null || uri.getHost().isEmpty());
    }

    private static WebResourceResponse blockedResponse() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Offline only", null,
            new ByteArrayInputStream(new byte[0]));
    }

    private void callGame(String method) {
        if (gameView != null) {
            gameView.evaluateJavascript("if(window.gameApp && typeof window.gameApp." + method +
                "==='function'){window.gameApp." + method + "();}", null);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if (gameView != null) {
            gameView.onResume();
            callGame("onForeground");
        }
    }

    @Override protected void onPause() {
        callGame("onBackground");
        if (gameView != null) gameView.onPause();
        super.onPause();
    }

    @Override public void onBackPressed() { callGame("onBack"); }

    @Override protected void onDestroy() {
        if (gameView != null) {
            gameView.removeJavascriptInterface("AndroidStore");
            gameView.destroy();
            gameView = null;
        }
        super.onDestroy();
    }

    /** Only a bounded JSON save slot is exposed to the packaged, offline page. */
    private final class SaveStore {
        private final SharedPreferences preferences =
            getSharedPreferences("guardian_save", MODE_PRIVATE);

        @JavascriptInterface public String load() {
            return preferences.getString("save_v1", "");
        }

        @JavascriptInterface public void save(String json) {
            if (json == null || json.length() > 524288) {
                throw new IllegalArgumentException("Invalid save length");
            }
            try { new JSONObject(json); }
            catch (JSONException error) { throw new IllegalArgumentException("Invalid save JSON", error); }
            if (!preferences.edit().putString("save_v1", json).commit()) {
                throw new IllegalStateException("Save could not be written");
            }
        }
    }
}
