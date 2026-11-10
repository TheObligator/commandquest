package forge.web;

import org.testng.Assert;
import org.testng.annotations.Test;

public class ConvexAuthTest {

    @Test
    public void acceptsValidTokensAndRejectsTheRest() throws Exception {
        TestTokens t = new TestTokens();
        ConvexAuth auth = t.auth();
        Assert.assertEquals(auth.verify(t.valid("user42")), TestTokens.ISSUER + "#user42");

        long past = System.currentTimeMillis() / 1000 - 3600;
        assertRejected(auth, t.token(TestTokens.ISSUER, "user42|s", past), "expired");
        long future = System.currentTimeMillis() / 1000 + 3600;
        assertRejected(auth, t.token("https://evil.convex.site", "user42|s", future), "unknown issuer");
        String good = t.valid("user42");
        String forged = good.substring(0, good.lastIndexOf('.') + 1) + "AAAA" + good.substring(good.lastIndexOf('.') + 5);
        assertRejected(auth, forged, "bad signature");
        TestTokens other = new TestTokens();
        assertRejected(auth, other.valid("user42"), "signed by another key");
        assertRejected(auth, "not-a-token", "garbage");
        assertRejected(auth, null, "missing");
    }

    private static void assertRejected(ConvexAuth auth, String token, String why) {
        try {
            auth.verify(token);
            Assert.fail("accepted a token that should be rejected: " + why);
        } catch (Exception expected) {
            // rejected
        }
    }
}
