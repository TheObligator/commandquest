package forge.web;

import io.javalin.Javalin;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
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
