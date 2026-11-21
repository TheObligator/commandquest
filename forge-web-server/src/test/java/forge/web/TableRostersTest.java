package forge.web;

import io.javalin.Javalin;
import java.util.concurrent.atomic.AtomicInteger;
import org.testng.Assert;
import org.testng.annotations.Test;

/** Fetching a table's roster from Convex rides out a brief 5xx (a 503 Convex sent once in a real game). */
public class TableRostersTest {

    private static final String KEY = "0123456789abcdef0123456789abcdef";
    private static final String ROSTER = "{\"name\":\"Friday\",\"players\":[{\"user\":\"u1\",\"name\":\"Ann\"}],\"ai\":3,\"freePlay\":true,\"rewind\":2}";

    /** A stand-in Convex whose roster endpoint fails `failures` times with `status`, then answers. */
    private static Javalin convex(AtomicInteger calls, int failures, int status) {
        return Javalin.create(cfg -> cfg.routes.get("/tables/roster", ctx -> {
            if (calls.incrementAndGet() <= failures) {
                ctx.status(status).result("Service Unavailable");
            } else {
                ctx.contentType("application/json").result(ROSTER);
            }
        })).start(0);
    }

    @Test
    public void retriesAFewTimesOnA503() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        Javalin app = convex(calls, 2, 503);
        try {
            TableRosters.Roster r = new TableRosters.Http(new long[] {10, 10, 10}).fetch("http://localhost:" + app.port(), KEY);
            Assert.assertNotNull(r);
            Assert.assertEquals(r.tableName(), "Friday");
            Assert.assertEquals(r.players().get(0).name(), "Ann");
            Assert.assertEquals(r.ai(), 3);
            Assert.assertEquals(calls.get(), 3);
        } finally {
            app.stop();
        }
    }

    @Test
    public void givesUpAfterTheLastRetry() {
        AtomicInteger calls = new AtomicInteger();
        Javalin app = convex(calls, 100, 503);
        try {
            Exception e = Assert.expectThrows(Exception.class,
                    () -> new TableRosters.Http(new long[] {10, 10}).fetch("http://localhost:" + app.port(), KEY));
            Assert.assertEquals(e.getMessage(), "Convex answered 503");
            Assert.assertEquals(calls.get(), 3);
        } finally {
            app.stop();
        }
    }

    @Test
    public void doesNotRetryAClientError() {
        AtomicInteger calls = new AtomicInteger();
        Javalin app = convex(calls, 100, 400);
        try {
            Assert.expectThrows(IllegalStateException.class,
                    () -> new TableRosters.Http(new long[] {10, 10}).fetch("http://localhost:" + app.port(), KEY));
            Assert.assertEquals(calls.get(), 1);
        } finally {
            app.stop();
        }
    }
}
