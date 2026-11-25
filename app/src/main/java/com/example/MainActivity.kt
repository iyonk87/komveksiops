package com.example

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import java.io.ByteArrayInputStream
import java.io.IOException
import java.nio.charset.StandardCharsets
import org.json.JSONObject

class MainActivity : ComponentActivity() {

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    setContent {
      var webViewRef by remember { mutableStateOf<WebView?>(null) }
      var canGoBack by remember { mutableStateOf(false) }
      var isLoading by remember { mutableStateOf(true) }
      var loadError by remember { mutableStateOf<String?>(null) }

      BackHandler(enabled = canGoBack) {
        webViewRef?.goBack()
      }

      Box(
        modifier = Modifier
          .fillMaxSize()
          .background(ComposeColor(0xFFF8FAFC))
          .windowInsetsPadding(WindowInsets.safeDrawing)
      ) {
        AndroidView(
          modifier = Modifier.fillMaxSize(),
          factory = { ctx ->
            WebView(ctx).apply {
              setBackgroundColor(Color.parseColor("#F8FAFC"))
              setLayerType(View.LAYER_TYPE_HARDWARE, null)
              settings.javaScriptEnabled = true
              settings.domStorageEnabled = true
              settings.databaseEnabled = true
              settings.allowFileAccess = true
              settings.javaScriptCanOpenWindowsAutomatically = false
              settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

              webChromeClient = WebChromeClient()
              webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                  view: WebView?,
                  request: WebResourceRequest?
                ): WebResourceResponse? {
                  val url = request?.url ?: return null
                  if (url.scheme != "https" || url.host != "localhost") return null

                  if (request.method.equals("OPTIONS", ignoreCase = true)) {
                    return WebResourceResponse(
                      "text/plain",
                      "UTF-8",
                      204,
                      "No Content",
                      mapOf(
                        "Access-Control-Allow-Origin" to "*",
                        "Access-Control-Allow-Methods" to "GET, OPTIONS",
                        "Access-Control-Allow-Headers" to "*"
                      ),
                      ByteArrayInputStream(ByteArray(0))
                    )
                  }

                  val rawPath = url.path?.trimStart('/') ?: ""
                  if (rawPath.isEmpty() || rawPath == "index.html") {
                    return serveIndexHtmlWithFirebaseConfig(ctx)
                  }

                  val assetPath = "public/$rawPath"
                  return try {
                    val stream = ctx.assets.open(assetPath)
                    WebResourceResponse(
                      guessMimeType(assetPath),
                      "UTF-8",
                      200,
                      "OK",
                      mapOf("Access-Control-Allow-Origin" to "*"),
                      stream
                    )
                  } catch (_: IOException) {
                    val lastSegment = rawPath.substringAfterLast('/')
                    if (lastSegment.contains('.')) {
                      WebResourceResponse(
                        "text/plain",
                        "UTF-8",
                        404,
                        "Not Found",
                        mapOf("Access-Control-Allow-Origin" to "*"),
                        ByteArrayInputStream(ByteArray(0))
                      )
                    } else {
                      serveIndexHtmlWithFirebaseConfig(ctx)
                    }
                  }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                  super.onPageFinished(view, url)
                  isLoading = false
                  canGoBack = view?.canGoBack() == true
                }

                override fun doUpdateVisitedHistory(
                  view: WebView?,
                  url: String?,
                  isReload: Boolean
                ) {
                  super.doUpdateVisitedHistory(view, url, isReload)
                  canGoBack = view?.canGoBack() == true
                }

                override fun onReceivedError(
                  view: WebView?,
                  request: WebResourceRequest?,
                  error: WebResourceError?
                ) {
                  super.onReceivedError(view, request, error)
                  if (request?.isForMainFrame == true) {
                    isLoading = false
                    loadError = error?.description?.toString() ?: "Gagal memuat antarmuka aplikasi."
                  }
                }
              }

              loadUrl("https://localhost/index.html")
              webViewRef = this
            }
          }
        )

        if (isLoading && loadError == null) {
          Box(
            modifier = Modifier
              .fillMaxSize()
              .background(ComposeColor(0xFFF8FAFC)),
            contentAlignment = Alignment.Center
          ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
              CircularProgressIndicator(color = ComposeColor(0xFF4F46E5))
              Spacer(modifier = Modifier.height(12.dp))
              Text(
                text = "Memuat KonveksiOps...",
                color = ComposeColor(0xFF334155),
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium
              )
            }
          }
        }

        if (loadError != null) {
          Column(
            modifier = Modifier
              .fillMaxSize()
              .background(ComposeColor(0xFFF8FAFC))
              .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
          ) {
            Text(
              text = "Gagal Membuka KonveksiOps",
              color = ComposeColor(0xFF0F172A),
              fontSize = 16.sp,
              fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
              text = loadError ?: "",
              color = ComposeColor(0xFF475569),
              fontSize = 13.sp,
              textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(
              onClick = {
                loadError = null
                isLoading = true
                webViewRef?.loadUrl("https://localhost/index.html")
              }
            ) {
              Text("Muat Ulang")
            }
          }
        }
      }
    }
  }

  private fun getStringResByName(ctx: Context, name: String): String {
    val resId = ctx.resources.getIdentifier(name, "string", ctx.packageName)
    return if (resId != 0) ctx.getString(resId).trim() else ""
  }

  private fun buildAndroidFirebaseConfigJson(ctx: Context): String? {
    val apiKey = getStringResByName(ctx, "google_api_key")
    val projectId = getStringResByName(ctx, "project_id")
    val appId = getStringResByName(ctx, "google_app_id")
    if (apiKey.isEmpty() || projectId.isEmpty() || appId.isEmpty()) {
      return null
    }
    val json = JSONObject().apply {
      put("apiKey", apiKey)
      put("authDomain", "$projectId.firebaseapp.com")
      put("projectId", projectId)
      put("storageBucket", getStringResByName(ctx, "google_storage_bucket"))
      put("messagingSenderId", getStringResByName(ctx, "gcm_defaultSenderId"))
      put("appId", appId)
      val databaseId = getStringResByName(ctx, "firestore_database_id")
      if (databaseId.isNotEmpty()) {
        put("databaseId", databaseId)
      }
    }
    return json.toString()
  }

  private fun serveIndexHtmlWithFirebaseConfig(ctx: Context): WebResourceResponse? {
    return try {
      val html = ctx.assets.open("public/index.html").bufferedReader(StandardCharsets.UTF_8).use {
        it.readText()
      }
      val configJson = buildAndroidFirebaseConfigJson(ctx)
      val finalHtml = if (configJson != null && html.contains("</head>")) {
        val scriptTag = "<script>window.__ANDROID_FIREBASE_CONFIG__=$configJson;</script>"
        html.replace("</head>", "$scriptTag</head>")
      } else {
        html
      }
      WebResourceResponse(
        "text/html",
        "UTF-8",
        200,
        "OK",
        mapOf("Access-Control-Allow-Origin" to "*"),
        ByteArrayInputStream(finalHtml.toByteArray(StandardCharsets.UTF_8))
      )
    } catch (_: IOException) {
      null
    }
  }

  private fun guessMimeType(path: String): String {
    val lower = path.lowercase()
    return when {
      lower.endsWith(".html") -> "text/html"
      lower.endsWith(".js") || lower.endsWith(".mjs") -> "application/javascript"
      lower.endsWith(".css") -> "text/css"
      lower.endsWith(".json") -> "application/json"
      lower.endsWith(".svg") -> "image/svg+xml"
      lower.endsWith(".png") -> "image/png"
      lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
      lower.endsWith(".webp") -> "image/webp"
      lower.endsWith(".woff2") -> "font/woff2"
      lower.endsWith(".woff") -> "font/woff"
      else -> "application/octet-stream"
    }
  }
}
