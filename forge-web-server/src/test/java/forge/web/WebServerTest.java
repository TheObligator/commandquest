package forge.web;

import io.javalin.Javalin;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.util.concurrent.CompletableFuture;
import java.util.Set;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import org.testng.Assert;
import org.testng.annotations.AfterClass;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

public class WebServerTest {

    private Javalin app;
    private int port;
    private final HttpClient client = HttpClient.newHttpClient();

    @BeforeClass
    public void start() {
        app = WebServer.create(new WebServer.Options(null)).start(0);
        port = app.port();
    }

    @AfterClass(alwaysRun = true)
    public void stop() {
        if (app != null) {
            app.stop();
        }
    }

    @Test
    public void healthReturnsOk() throws Exception {
        HttpResponse<String> res = client.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/health")).build(),
                HttpResponse.BodyHandlers.ofString());
        Assert.assertEquals(res.statusCode(), 200);
        Assert.assertTrue(res.body().contains("\"status\":\"ok\""), res.body());
    }

    @Test
    public void allowedOriginsGateHealthAndWebSocket() throws Exception {
        Javalin locked = WebServer.create(new WebServer.Options(null, Set.of("https://commandquest.app"), "abc123")).start(0);
        try {
            String base = "localhost:" + locked.port();
            HttpResponse<String> ok = client.send(HttpRequest.newBuilder(URI.create("http://" + base + "/health"))
                    .header("Origin", "https://commandquest.app").build(), HttpResponse.BodyHandlers.ofString());
            Assert.assertEquals(ok.headers().firstValue("Access-Control-Allow-Origin").orElse(null), "https://commandquest.app");
            Assert.assertTrue(ok.body().contains("\"version\":\"abc123\""), ok.body());

            HttpResponse<String> other = client.send(HttpRequest.newBuilder(URI.create("http://" + base + "/health"))
                    .header("Origin", "https://evil.example").build(), HttpResponse.BodyHandlers.ofString());
            Assert.assertTrue(other.headers().firstValue("Access-Control-Allow-Origin").isEmpty());

            Assert.assertNotNull(client.newWebSocketBuilder().header("Origin", "https://commandquest.app")
                    .buildAsync(URI.create("ws://" + base + "/ws"), new WebSocket.Listener() { })
                    .get(5, TimeUnit.SECONDS));
            try {
                client.newWebSocketBuilder().header("Origin", "https://evil.example")
                        .buildAsync(URI.create("ws://" + base + "/ws"), new WebSocket.Listener() { })
                        .get(5, TimeUnit.SECONDS);
                Assert.fail("socket from a foreign origin was accepted");
            } catch (ExecutionException expected) {
                // refused at the upgrade
            }
        } finally {
            locked.stop();
        }
    }

    @Test
    public void webSocketEchoes() throws Exception {
        CompletableFuture<String> reply = new CompletableFuture<>();
        WebSocket ws = client.newWebSocketBuilder()
                .buildAsync(URI.create("ws://localhost:" + port + "/ws"), new WebSocket.Listener() {
                    @Override
                    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
                        reply.complete(data.toString());
                        return null;
                    }
                })
                .get(5, TimeUnit.SECONDS);
        ws.sendText("hello forge", true);
        Assert.assertEquals(reply.get(5, TimeUnit.SECONDS), "hello forge");
        ws.sendClose(WebSocket.NORMAL_CLOSURE, "done");
    }
}
