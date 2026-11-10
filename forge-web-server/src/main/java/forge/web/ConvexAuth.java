package forge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.time.Duration;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Checks a Convex Auth sign-in token (the JWT the site's {@code useAuthToken()} returns), so the
 * game server knows which signed-in user a socket belongs to without its own accounts. Tokens are
 * RS256, issued by a Convex deployment's site URL with audience {@code convex}; the public keys
 * come from {@code <issuer>/.well-known/jwks.json}.
 */
public final class ConvexAuth {

    /** Default issuers: the staging and production Convex deployments (docs/deploy.md). */
    public static final String DEFAULT_ISSUERS =
            "https://robust-barracuda-45.convex.site,https://impressive-manatee-540.convex.site";

    /** Finds the public key for a token. Tests pass their own. */
    public interface KeySource {
        PublicKey key(String issuer, String kid) throws Exception;
    }

    private static final ObjectMapper JSON = new ObjectMapper();
    private final Set<String> issuers;
    private final KeySource keys;

    public ConvexAuth(Set<String> issuers, KeySource keys) {
        this.issuers = issuers;
        this.keys = keys;
    }

    /** From {@code CONVEX_ISSUERS} (comma-separated), fetching keys over HTTPS. */
    public static ConvexAuth fromEnv() {
        String env = System.getenv("CONVEX_ISSUERS");
        String list = env == null || env.isBlank() ? DEFAULT_ISSUERS : env;
        Set<String> issuers = Arrays.stream(list.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
        return new ConvexAuth(issuers, new Jwks());
    }

    /** The user id in a valid token. Throws if the token is invalid, expired or from another issuer. */
    public String verify(String token) throws Exception {
        String[] parts = token == null ? new String[0] : token.split("\\.");
        if (parts.length != 3) {
            throw new SecurityException("Not a sign-in token");
        }
        Base64.Decoder b64 = Base64.getUrlDecoder();
        JsonNode header = JSON.readTree(b64.decode(parts[0]));
        JsonNode claims = JSON.readTree(b64.decode(parts[1]));
        if (!"RS256".equals(header.path("alg").asText())) {
            throw new SecurityException("Unexpected token algorithm");
        }
        String iss = claims.path("iss").asText();
        if (!issuers.contains(iss)) {
            throw new SecurityException("Token from an unknown issuer");
        }
        JsonNode aud = claims.path("aud");
        boolean audOk = aud.isArray() ? JSON.convertValue(aud, java.util.List.class).contains("convex") : "convex".equals(aud.asText());
        if (!audOk) {
            throw new SecurityException("Token for another audience");
        }
        long now = System.currentTimeMillis() / 1000;
        if (claims.path("exp").asLong(0) < now - 60) {
            throw new SecurityException("Sign-in token expired");
        }
        PublicKey key = keys.key(iss, header.path("kid").asText(null));
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initVerify(key);
        sig.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        if (!sig.verify(b64.decode(parts[2]))) {
            throw new SecurityException("Bad token signature");
        }
        String sub = claims.path("sub").asText("");
        int bar = sub.indexOf('|'); // Convex Auth: "<userId>|<sessionId>"
        String user = bar > 0 ? sub.substring(0, bar) : sub;
        if (user.isEmpty()) {
            throw new SecurityException("Token has no user");
        }
        return iss + "#" + user;
    }

    /** Keys from each issuer's JWKS, cached; refetched (at most once a minute) for an unknown key id. */
    static final class Jwks implements KeySource {
        private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        private final Map<String, Map<String, PublicKey>> cache = new ConcurrentHashMap<>();
        private final Map<String, Long> fetchedAt = new ConcurrentHashMap<>();

        @Override
        public PublicKey key(String issuer, String kid) throws Exception {
            Map<String, PublicKey> known = cache.get(issuer);
            PublicKey k = known == null ? null : pick(known, kid);
            if (k != null) {
                return k;
            }
            long last = fetchedAt.getOrDefault(issuer, 0L);
            if (known != null && System.currentTimeMillis() - last < 60_000) {
                throw new SecurityException("Unknown signing key");
            }
            fetchedAt.put(issuer, System.currentTimeMillis());
            HttpResponse<String> res = http.send(HttpRequest.newBuilder(URI.create(issuer + "/.well-known/jwks.json"))
                    .timeout(Duration.ofSeconds(10)).header("User-Agent", "CommandQuest/1.0").build(),
                    HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                throw new SecurityException("Couldn't load sign-in keys (" + res.statusCode() + ")");
            }
            Map<String, PublicKey> fresh = new ConcurrentHashMap<>();
            KeyFactory rsa = KeyFactory.getInstance("RSA");
            for (JsonNode jwk : JSON.readTree(res.body()).path("keys")) {
                if (!"RSA".equals(jwk.path("kty").asText())) {
                    continue;
                }
                BigInteger n = new BigInteger(1, Base64.getUrlDecoder().decode(jwk.path("n").asText()));
                BigInteger e = new BigInteger(1, Base64.getUrlDecoder().decode(jwk.path("e").asText()));
                fresh.put(jwk.path("kid").asText(""), rsa.generatePublic(new RSAPublicKeySpec(n, e)));
            }
            cache.put(issuer, fresh);
            k = pick(fresh, kid);
            if (k == null) {
                throw new SecurityException("Unknown signing key");
            }
            return k;
        }

        private static PublicKey pick(Map<String, PublicKey> keys, String kid) {
            if (kid != null && keys.containsKey(kid)) {
                return keys.get(kid);
            }
            // Convex's JWKS has a single key, sometimes without a kid; the signature check still applies.
            return keys.size() == 1 ? keys.values().iterator().next() : null;
        }
    }
}
