// The About (#/about), Privacy (#/privacy) and Terms (#/terms) pages, linked from the footer and
// the sign-in page. When the Privacy Policy or Terms change, update LEGAL_UPDATED.

export const CONTACT_EMAIL = "obligator@commandquest.app";
/** When the Privacy Policy and Terms last changed, as shown on both. */
export const LEGAL_UPDATED = "November 27, 2026";

const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener">{children}</a>
);

export function About() {
  return (
    <article className="legal">
      <h1>About CommandQuest</h1>
      <p className="legal-sub">Free four-player Commander in your browser.</p>
      <p>
        CommandQuest lets you build Commander decks and play them in your browser, judged by a real rules engine. It's free, with
        no ads and nothing for sale.
      </p>
      <p>It's built and run by one person as a hobby project. That also means things can break: if they do, please tell me.</p>

      <h2>Built on</h2>
      <ul>
        <li>
          <Ext href="https://github.com/Card-Forge/forge">Forge</Ext>, the open-source rules engine that runs every game.
          CommandQuest is a fork of Forge and is open source too, under the same GPL-3.0 license:{" "}
          <Ext href="https://github.com/TheObligator/commandquest">source code on GitHub</Ext>.
        </li>
        <li><Ext href="https://scryfall.com">Scryfall</Ext> for card data and images.</li>
        <li>
          <Ext href="https://commanderspellbook.com">Commander Spellbook</Ext> for combos, and{" "}
          <Ext href="https://edhrec.com">EDHREC</Ext> for card suggestions.
        </li>
        <li>
          Deck import from <Ext href="https://moxfield.com">Moxfield</Ext> and <Ext href="https://archidekt.com">Archidekt</Ext>.
        </li>
      </ul>
      <p>None of these projects endorse CommandQuest.</p>

      <h2>Wizards of the Coast</h2>
      <p>
        CommandQuest is unofficial Fan Content permitted under the{" "}
        <Ext href="https://company.wizards.com/en/legal/fancontentpolicy">Fan Content Policy</Ext>. Not approved/endorsed by
        Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
      </p>

      <h2>Contact</h2>
      <p>Bugs, ideas, questions, or a rights holder's request: <Mail />.</p>
    </article>
  );
}

export function Privacy() {
  return (
    <article className="legal">
      <h1>Privacy Policy</h1>
      <p className="legal-sub">Last updated: {LEGAL_UPDATED}</p>
      <div className="legal-box">
        <p>
          <strong>Short version:</strong> we keep what's needed to run your account, decks and games. No ads, no analytics, no
          tracking, and we never sell anything about you.
        </p>
      </div>

      <h2>Who runs it</h2>
      <p>CommandQuest is run by an individual, reachable at <Mail />.</p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your email address. If you sign in with Google or Discord, the name, email and profile
          picture they share with us. The username you pick.
        </li>
        <li>
          <strong>What you make:</strong> decks (with a changelog of their edits), folders, packages, settings, stop presets,
          recorded combos, the tables you create or join, and the comments, likes and favorites you leave on shared decks.
        </li>
        <li>
          <strong>Games:</strong> live games run on our game server. A finished game is saved as a replay for the people who
          played in it: each player keeps their last 5, plus up to 5 they save.
        </li>
      </ul>

      <h2>What other players see</h2>
      <p>
        Your username (or your name, until you pick a username) at tables, in games and in replays, and the cards you play.
      </p>
      <p>
        Decks you share: new decks start <strong>public</strong>, so anyone can find them in Browse decks, with your username,
        the cards, tags, bracket and changelog. Make a deck <strong>unlisted</strong> (only people with its link) or{" "}
        <strong>private</strong> (only you) with its Share button. Decks made before sharing existed stay private until you share
        them. Comments you post on shared decks show your username. Likes show only as a count, and your favorites are only
        yours. Game settings saved with a deck, your folders and your email stay private.
      </p>

      <h2>Your browser</h2>
      <p>
        The site keeps your sign-in and some preferences in your browser's storage. When you open a shared deck without signing
        in, a random id kept there lets us count you once a day in the deck's views; we forget it within two days. There are no
        advertising or tracking cookies.
      </p>

      <h2>Do Not Track</h2>
      <p>
        We don't track you across sites or use ads or analytics, so Do Not Track and Global Privacy Control signals have nothing
        to turn off. Every visitor is treated that way.
      </p>

      <h2>Email</h2>
      <p>We only email you sign-in links and codes you ask for. Never newsletters or marketing.</p>

      <h2>Services we use</h2>
      <ul>
        <li><strong>Convex</strong> stores accounts and everything above.</li>
        <li><strong>Cloudflare</strong> serves the site and carries game connections, so it sees your IP address.</li>
        <li><strong>Resend</strong> sends sign-in emails, so it sees your email address.</li>
        <li><strong>Google</strong> or <strong>Discord</strong>, if you sign in with them.</li>
        <li>
          Your browser loads card images and data straight from <strong>Scryfall</strong> and <strong>EDHREC</strong>, which see
          your IP address like any website. Deck imports (Moxfield, Archidekt) and combo lookups (Commander Spellbook) go through
          our servers and send only the deck link or card list.
        </li>
      </ul>

      <h2>Seeing and correcting your data</h2>
      <p>
        Your username, decks and settings are yours to view and edit in the app. For anything else we hold about you, email{" "}
        <Mail />.
      </p>

      <h2>Keeping and deleting</h2>
      <p>
        We keep your data while you have an account. <strong>Settings → Delete account</strong> deletes your account and
        everything in it right away. If you can't sign in, email <Mail /> from your account's address and we'll delete it within
        30 days. Replays that other players kept still show the name you played under.
      </p>

      <h2>California privacy rights</h2>
      <p>
        We don't sell or share personal information, as California law defines those terms. You can ask to know, correct or
        delete what we hold about you, and we won't treat you any differently for asking.
      </p>

      <h2>Children</h2>
      <p>CommandQuest isn't meant for children under 13, and we don't knowingly keep their data.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the new version goes here with a new date.</p>
    </article>
  );
}

export function Terms() {
  return (
    <article className="legal">
      <h1>Terms of Use</h1>
      <p className="legal-sub">Last updated: {LEGAL_UPDATED}</p>
      <div className="legal-box">
        <p>
          <strong>Short version:</strong> it's free and offered as-is. Be decent to other players, and don't abuse the servers.
        </p>
      </div>

      <h2>Using CommandQuest</h2>
      <p>
        By using the site you agree to these terms and the <a href="#/privacy">Privacy Policy</a>. You need to be at least 13.
      </p>

      <h2>Be decent</h2>
      <ul>
        <li>No harassment, hate, or offensive usernames.</li>
        <li>Don't cheat, exploit bugs on purpose, overload or attack the servers, or scrape the site with bots.</li>
        <li>We may rename usernames, end games, or suspend accounts that break these rules.</li>
      </ul>

      <h2>Your stuff</h2>
      <p>
        Your decks are yours. You let us store them and show them as needed to run the site, for example the cards you play in a
        game, and decks and comments you share to the people you share them with. Anyone can copy a deck you share publicly or by
        link into their own account.
      </p>

      <h2>Ending your account</h2>
      <p>
        You can delete your account at any time in <a href="#/settings">Settings</a>. We may suspend accounts that break these
        rules.
      </p>

      <h2>No guarantees</h2>
      <p>
        CommandQuest is a free hobby project, provided "as is" without warranties. It may have bugs, rules mistakes, or downtime,
        and it may change or shut down. Games in progress can end when the server restarts. Keep your own copy (Export) of any
        deck you can't lose. To the extent the law allows, we're not liable for any loss from using the site.
      </p>

      <h2>Magic and other rights</h2>
      <p>
        Magic: The Gathering and its cards belong to Wizards of the Coast. CommandQuest is unofficial Fan Content and isn't
        approved or endorsed by Wizards. CommandQuest's own code is open source under GPL-3.0.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of California and the United States. Any dispute goes to the state or
        federal courts located in California.
      </p>

      <h2>The rest of these terms</h2>
      <p>
        If any part of these terms can't be enforced, the rest still applies. These terms and the Privacy Policy are the whole
        agreement between you and CommandQuest.
      </p>

      <h2>Changes and contact</h2>
      <p>We may update these terms, and the new version goes here with a new date. Questions: <Mail />.</p>
    </article>
  );
}
