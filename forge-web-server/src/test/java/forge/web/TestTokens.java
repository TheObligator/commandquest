package forge.web;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;
import java.util.Set;

/** Signs Convex-style sign-in tokens with a test key. */
final class TestTokens {
    static final String ISSUER = "https://test.convex.site";
    final KeyPair keys;

    TestTokens() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        keys = g.generateKeyPair();
    }

    ConvexAuth auth() {
        return new ConvexAuth(Set.of(ISSUER), (iss, kid) -> keys.getPublic());
    }

    String token(String iss, String sub, long expSeconds) throws Exception {
        Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
        String header = b64.encodeToString("{\"alg\":\"RS256\",\"typ\":\"JWT\",\"kid\":\"k1\"}".getBytes(StandardCharsets.UTF_8));
        String claims = b64.encodeToString(("{\"iss\":\"" + iss + "\",\"aud\":\"convex\",\"sub\":\"" + sub + "\",\"exp\":" + expSeconds + "}")
                .getBytes(StandardCharsets.UTF_8));
        Signature s = Signature.getInstance("SHA256withRSA");
        s.initSign(keys.getPrivate());
        s.update((header + "." + claims).getBytes(StandardCharsets.US_ASCII));
        return header + "." + claims + "." + b64.encodeToString(s.sign());
    }

    String valid(String user) throws Exception {
        return token(ISSUER, user + "|session1", System.currentTimeMillis() / 1000 + 3600);
    }
}
