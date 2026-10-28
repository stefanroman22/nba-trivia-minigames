import type { Metadata } from "next";
import { LEGAL } from "../../configurations/legal";
import { SITE_NAME } from "../../configurations/site";
import LegalPage, { LegalHeading, LegalList, LegalSummary, LegalTable, MailLink, OperatorBlock, LegalLink } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `What ${LEGAL.service} collects, why, who handles it, how long it is kept, and how to see, export or delete it.`,
  alternates: { canonical: "/privacy" },
  // A child openGraph/twitter replaces the layout's wholesale (including the root share image), so the
  // shared fields are repeated.
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: "/privacy", title: `Privacy Policy | ${SITE_NAME}`, images: ["/opengraph-image"] },
  twitter: { card: "summary_large_image", title: `Privacy Policy | ${SITE_NAME}`, images: ["/opengraph-image"] },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" path="/privacy">
      <LegalSummary>
        <strong>The short version.</strong>
        <LegalList>
          <li>You can play without an account, and then we do not keep your name or email.</li>
          <li>An account stores your email, a display name, your scores and the things you choose to add (friends, and later a photo). Your display name, player ID, rank and points are visible to other players, on the public leaderboard too, whatever your age. Your email is never shown.</li>
          <li>Ads (not live yet): when we switch ads on, Google will show non-personalised ads, which keep {LEGAL.service} free; until then no ad code loads. In the EEA, the UK and Switzerland we will ask first, and you will be able to change your choice at any time with <strong>Privacy and cookie settings</strong> at the bottom of every page. There are no third-party analytics. We never sell your data. For signed-in players we count how long you use the site each day and note the country you connect from, only for our own statistics.</li>
          <li>Ads never get your email, display name, player ID, scores or anything else from your account.</li>
          <li>You can download everything we hold and delete your account yourself, from your profile.</li>
          <li>Accounts are for people aged {LEGAL.minimumAge} and over, as the Terms say. We do not ask your age when you sign up.</li>
        </LegalList>
      </LegalSummary>

      <LegalHeading id="who">1. Who we are</LegalHeading>
      <p>
        {LEGAL.service} is a free NBA trivia website. The person or company below is the
        controller of your personal data under the GDPR, and the contact for every privacy request.
      </p>
      <OperatorBlock />
      <p>We have not appointed a data protection officer. Write to <MailLink /> for anything in this policy.</p>

      <LegalHeading id="collect">2. What we collect, why, and for how long</LegalHeading>
      <p>
        The table covers everything we store about you. &ldquo;Contract&rdquo; means we need it to give you the service you
        asked for; &ldquo;legitimate interests&rdquo; means we need it to keep the service safe and fair and have weighed that
        against your rights.
      </p>
      <LegalTable
        head={["What", "Why", "Basis", "How long"]}
        rows={[
          ["Playing as a guest: answers you submit to questions (no name, no email), and a random device code in your browser used to give each device one Wordle and one LeContexto a day", "Question statistics (for example how fans answer Fan Favorites); the daily Wordle and LeContexto limit", "Legitimate interests", "Answers: 30 days. Wordle and LeContexto plays: removed after the day ends. The device code stays in your browser until you clear it."],
          ["Account details: email, display name, public player ID, a hash of your password (never the password), or your Google account ID", "Sign you in and run your account", "Contract", "Until you delete the account"],
          ["Points and rank", "Leaderboards and matchmaking", "Contract", "Until you delete the account"],
          ["Consent record: the Terms version you accepted, when, and how (creating an account by email, or continuing with Google). Accounts opened under an earlier version of this policy may also hold that sign-up's 13+ confirmation and, if a birth month and year was given, that month and year and whether the player was under or over 16; we no longer use any of it. We never keep the day of birth", "Prove the account was opened properly", "Legitimate interests and legal obligation", "Until you delete the account"],
          [`Profile photo (optional), resized to 256x256. Photo upload is switched off until our automatic photo check is live; this row applies from then`, "Show your photo to other players", "Consent: you choose to add it and can remove it any time", "Until you remove it or delete the account"],
          ["Friends, friend requests and blocked players", "Friends features", "Contract", "Until you remove them or delete the account"],
          ["Game history (game, score, time) and your own answers", "Your record, and fair play", "Contract", "Game history: 24 months. Answers: 30 days."],
          ["Time on the site (signed-in players only): how many seconds a day you had the site open and in use (counting stops when the tab is hidden or you have been idle for 3 minutes), and the country your connection comes from, which our hosting provider works out from your network address. We do not store the address itself", "Understand how much and from where the service is used, so we can improve it and plan capacity", "Legitimate interests", "12 months"],
          ["Which questions you have already been shown (the game and the question, not your answers)", "So you don't get the same question twice", "Contract", "Until the question is retired or you delete the account"],
          ["Problem reports about questions (the game, the question and your optional note; linked to your account if you are signed in)", "Fix wrong questions", "Legitimate interests", "Until handled, at most 12 months, and deleted with your account. When we handle a report, your note alone (not who sent it) is kept with the question until 180 days after the question is retired. To check a reported question, that note (still not who sent it), together with anonymous counts of the wrong answers players typed, is passed to Anthropic's AI model Claude, which researches the question for us; the copies our job makes for that are deleted after one day."],
          ["Feedback you send (rating, message, page, and your email and name if you are signed in)", "Improve the service and reply to you", "Legitimate interests", "Until handled; resolved feedback is deleted after 12 months, and with your account"],
          ["Moderation records: strikes, a reason code (never the offending text), and a one-way hash of your network address", "Enforce the rules and stop repeat abuse", "Legitimate interests", "The events and the address hash: 12 months (or while a ban stands). The strike count and ban status are part of your account and stay while it exists. See section 7 for banned accounts."],
          ["Rate-limit counters (your IP address, in our database)", "Stop sign-in guessing and request flooding", "Legitimate interests", "About an hour"],
          ["Server logs kept by our hosting provider (IP address, time, address requested)", "Security and keeping the service running", "Legitimate interests", "A short period set by the provider"],
          ["Multiplayer: while you play online, your display name, ID, rank, points and photo are held in a game server's memory", "Run the match", "Contract", "Until the match ends. Your final score is then saved to your game history and points, as for a solo game"],
          ["Ads (not live yet): when we switch ads on and a page shows an ad, your browser will connect to Google, which receives your IP address, browser and device details, the address of the page and, if you allow it, reads and sets advertising cookies (section 11). We never pass Google anything from your account. Until then no ad code loads", "Show non-personalised ads that pay for the service, limit how often you see the same ad, and stop ad fraud", "Consent for advertising cookies (asked in the EEA, UK and Switzerland before any ad cookie is set); legitimate interests for showing a basic ad without cookies and for fraud prevention", "We keep nothing ourselves except totals Google reports to us (earnings, numbers of ads shown), which are not about you. Google keeps its data as its privacy policy says; cookie lifetimes are in section 11"],
          ["Your cookie choices (not live yet; when we switch ads on): what you choose in the privacy message, stored as a code in a cookie in your browser", "Remember your choice and prove it was given", "Legal obligation", "13 months, then we ask again; earlier if you change it with Privacy and cookie settings"],
        ]}
      />
      <p>
        If you do not give us the account details above we cannot create an account, but you can still play as a guest.
      </p>

      <LegalHeading id="public">3. What other people can see</LegalHeading>
      <LegalList>
        <li><strong>Everyone</strong> who opens the site can see leaderboard rows: display name, player ID, rank, points and photo (if you added one). This applies to every account, whatever its age.</li>
        <li><strong>Other players</strong> can find you by name or player ID, see your photo, and send a friend request; online opponents see your name, ID, rank, points and photo during a match.</li>
        <li><strong>Nobody else</strong> sees your email, your game history, your time on the site, your country, your answers or your feedback. Only the operator, and anyone the operator authorises to run the service, can read those.</li>
        <li><strong>Advertisers</strong> never see your account. Ads (not live yet): when we switch ads on, Google and, if you allow it, its ad partners will see your browser as described in sections 5 and 11, not who you are on {LEGAL.service}.</li>
      </LegalList>
      <p>Please do not use your real name as your display name, and do not upload a photo you do not want others to see.</p>

      <LegalHeading id="google">4. Sign in with Google</LegalHeading>
      <p>
        If you choose it, Google tells us your email address and a stable ID for your Google account. We do not receive your
        Google password and we read nothing else from your Google account. We use that information only to create and sign
        you in to your {LEGAL.service} account. We do not sell it, do not use it for advertising and do not transfer it to
        anyone except our service providers listed below, and only as needed to run your account. Continuing with Google
        creates an account if you do not have one yet, as signing up by email does; the sign-up screen says that doing so
        means you agree to the Terms and this policy. Google&apos;s sign-in
        window loads only when you open the login box and is run by Google under its own privacy policy. Our use of
        information received from Google APIs follows the Google API Services User Data Policy, including its Limited Use
        requirements. Signing in with Google is separate from ads (not live yet): we never send your email, your Google
        account ID or anything else from your {LEGAL.service} account to Google&apos;s advertising systems.
      </p>

      <LegalHeading id="shared">5. Who handles your data for us</LegalHeading>
      <LegalTable
        head={["Provider", "What it does", "Where"]}
        rows={[
          ["Vercel", "Hosts the website and the account server (and will host our automatic photo check)", "Global network; the account server runs in Frankfurt, Germany"],
          ["Supabase", "Hosts the database that holds your account and game data", "Frankfurt, Germany (EU)"],
          ["GitHub", "Stores our code and runs scheduled maintenance jobs (such as the weekly clean-up) that connect to the database", "United States and global"],
          ["Anthropic", "Its AI model Claude, run from a GitHub job with no access to the database, checks questions players reported; it receives the question and the report notes, never who sent them", "United States"],
          ["Railway", "Runs the real-time game server for online matches (it holds match data in memory only)", "Amsterdam, Netherlands (EU)"],
          ["Google", "Runs the sign-in window and holds your Google account, as its own controller", "Worldwide"],
          ["Google (AdSense and its privacy message)", "Ads (not live yet): when we switch ads on, shows the ads and the cookie choices message, as its own controller (see below)", "Google Ireland Limited for the EEA and Switzerland, Google LLC (United States) worldwide"],
        ]}
      />
      <p>
        The operator also uses development tools, including AI-assisted ones, to build and maintain the service. They may be
        given access to the systems above for maintenance only.
      </p>
      <p>
        The providers above, except Google for ads and sign-in, act on our instructions under data processing terms. We
        do not use Google Fonts or any analytics service.
      </p>
      <p>
        <strong>Advertising.</strong> Ads (not live yet): when we switch ads on, we will use Google AdSense to show ads;
        until then no ad code loads. When ads are on: Third-party vendors, including Google, use cookies to serve ads
        based on your prior visits to this website or other websites. Google&apos;s use of advertising cookies enables it
        and its partners to serve ads to you based on your visits to this site and/or other sites on the internet. Google
        will show non-personalised ads (ads not based on your browsing) to everyone. Google decides how it uses that data, as an
        independent controller under its own{" "}
        <LegalLink href="https://policies.google.com/privacy">privacy policy</LegalLink>; see{" "}
        <LegalLink href="https://policies.google.com/technologies/partner-sites">how Google uses information from sites
        that use its services</LegalLink>. We decide only to put Google&apos;s ad code on our pages, and for that step
        (your browser contacting Google) we are responsible together with Google. Google&apos;s terms with us are its{" "}
        <LegalLink href="https://business.safety.google/controllerterms/">Controller-Controller Data Protection Terms</LegalLink>.
      </p>
      <p>
        When ads are on, if you agree in the privacy message, other advertising companies that Google works with
        (&ldquo;ad technology providers&rdquo;) may also set or read cookies to choose and measure ads. We will allow only
        Google and a short list of certified providers. The full, current list, with each company&apos;s purposes and a
        link to its own policy, will be in <strong>Privacy and cookie settings</strong> &rarr; Manage options &rarr;
        Vendors, at the bottom of every page.
      </p>
      <p>
        You can opt out of personalised advertising at any time: in{" "}
        <LegalLink href="https://www.google.com/settings/ads">Google&apos;s Ads Settings</LegalLink>, for many other
        companies at <LegalLink href="https://optout.aboutads.info">aboutads.info</LegalLink> (United States) or{" "}
        <LegalLink href="https://www.youronlinechoices.eu">youronlinechoices.eu</LegalLink> (Europe), and, once ads are
        on, on this site with <strong>Privacy and cookie settings</strong>. You will still see ads, but they will not be
        based on your browsing.
      </p>
      <p>
        <strong>Pictures loaded from other websites.</strong> Player photos are free-licence images from Wikimedia
        Commons, credited on the <LegalLink href="/credits">photo credits</LegalLink> page, and are loaded from{" "}
        <strong>upload.wikimedia.org</strong>, run by the Wikimedia Foundation, Inc. (United States). Teams are shown by
        their name, abbreviation and colours; no picture is loaded from the NBA&apos;s servers. When a game shows a player photo,
        your browser asks that server for it directly, so the server receives your IP address, your browser and device
        details and our site&apos;s address (never which page or game you are on, and nothing from your {LEGAL.service} account). We do not
        receive anything back about you and we have no contract with that organisation: it handles that data as its
        own controller, under its own privacy policy (
        <LegalLink href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy">Wikimedia Foundation</LegalLink>
        ). We are responsible together with it only for making your browser send that request; our basis is our
        legitimate interest in showing the pictures the games need without copying them onto our own servers. You can
        object: block <strong>upload.wikimedia.org</strong> in your browser or a content blocker and the games still work,
        with a silhouette instead of a player photo.
      </p>
      <p>
        We may disclose data if the law requires it, for example to answer a valid court order or request from a public
        authority. We check each request is valid, give the least data that satisfies it and, where the law allows, tell you
        before we do. We do not give anyone bulk access.
      </p>

      <LegalHeading id="transfers">6. Transfers outside your country</LegalHeading>
      <p>
        Some providers are US companies or process data outside the European Economic Area or the UK. Where that happens we
        rely on safeguards the law recognises: the EU&ndash;US Data Privacy Framework where the provider is certified, and
        otherwise the European Commission&apos;s Standard Contractual Clauses (with the UK addendum), which are part of the
        providers&apos; data processing terms. Ads (not live yet): when we switch ads on, Google, which will show our ads
        (section 5), transfers data from the EEA, the UK and Switzerland to Google LLC in the United States under the
        EU&ndash;US Data Privacy Framework (and its UK and Swiss extensions), with the Standard Contractual Clauses in its
        terms as a fallback. You can ask us for a copy of the relevant safeguard. The picture servers in
        section 5 are not our providers and we send them nothing ourselves: your browser connects to them, in the United
        States or wherever their network serves you from, and you can stop that by blocking them as described there.
      </p>

      <LegalHeading id="retention">7. How long we keep things</LegalHeading>
      <p>The periods are in the table in section 2 and applied automatically every week. In addition:</p>
      <LegalList>
        <li><strong>Sign-in sessions</strong> end after 90 days at most.</li>
        <li>
          <strong>Banned accounts.</strong> If you delete an account that was banned for breaking the rules, we remove
          everything about you except a minimal record (your email in a normalised form, the reason code, the number of
          strikes, the moderation events behind the ban with their one-way address hashes, and when the account was
          created) so the ban cannot be dodged by opening a new account. We keep that record only while it is needed to
          protect the service and other players, and in any case no longer than five years after the ban.
        </li>
        <li>
          <strong>Backups.</strong> Our database provider keeps routine backups for a limited period. Deleted data ages out
          of them on that schedule, and we never restore a deleted account.
        </li>
      </LegalList>

      <LegalHeading id="rights">8. Your rights, and how to use them</LegalHeading>
      <p>You can, free of charge:</p>
      <LegalList>
        <li><strong>See and take your data:</strong> Profile &rarr; Download my data gives you everything we hold, as a JSON file.</li>
        <li><strong>Correct it:</strong> change your display name and photo in your profile, or write to us for anything else.</li>
        <li><strong>Delete it:</strong> Profile &rarr; Delete account removes your account, friends, game history and answers straight away. You can remove just your photo from the same screen. A copy of a photo can stay in other people&apos;s browsers for up to a day, and hosting logs and backups age out on their own schedule.</li>
        <li><strong>Object or restrict:</strong> where we rely on legitimate interests you can object, and ask us to limit processing while we look at it.</li>
        <li><strong>Withdraw consent</strong> at any time, as easily as you gave it: for your photo, remove it; for ads and cookies (not live yet), once ads are on, open <strong>Privacy and cookie settings</strong> at the bottom of any page and change your choice (it applies from then on).</li>
        <li><strong>Opt out of personalised ads</strong> in Google&apos;s Ads Settings (section 5). When ads are on, if your browser sends a Global Privacy Control signal, it is honoured for ads where the law gives it effect (section 13).</li>
      </LegalList>
      <p>
        If you cannot use those buttons (for example your account is banned), write to <MailLink />. We answer within one
        month. We may ask you to confirm it is you by replying from the account&apos;s email address. If you are in the EU,
        the UK or another country with similar rights, you can also complain to your data protection authority.
        Requests about the data Google holds as its own controller are best sent to Google; we will forward any we
        receive.
      </p>

      <LegalHeading id="automated">9. Automated checks</LegalHeading>
      <p>
        Display names are checked automatically against a word list. Photos will be checked by an automatic image classifier
        on our own service before they are shown, and the classifier does not keep the picture; until that check is live,
        photo upload is switched off. A name or photo that is clearly not allowed is refused and counts as a
        strike (strikes do not expire); the third strike bans the account. We do not profile you or score you ourselves.
        Ads (not live yet): when we switch ads on, they will be non-personalised, not based on your browsing, and showing
        them has no legal or similarly significant effect on you. You can ask a person to
        review any strike or ban, and tell us your side, by writing to <MailLink /> (see the Terms, section 7).
      </p>

      <LegalHeading id="children">10. Age and children</LegalHeading>
      <p>
        The Terms say accounts are only for people aged {LEGAL.minimumAge} or over. We do not ask your age or birth date
        when you sign up, by email or with Google, and the app does not check it. Every account is treated the same: on
        the public leaderboard, found by name or player ID, shown by name to other players in online matches, and free to
        add a profile photo. If we learn that an account belongs to someone younger than {LEGAL.minimumAge}, we delete it.
        Anyone can play as a guest, and a guest&apos;s answers are not tied to a person. Parents and guardians can write to{" "}
        <MailLink /> to ask us to remove a child&apos;s data.
      </p>
      <p>
        <strong>Ads and young people.</strong> Ads (not live yet): when we switch ads on, Google will show only
        non-personalised ads (ads not based on browsing) to every visitor, guests and accounts alike, because we cannot
        know anyone&apos;s age, and we will block gambling and betting ads, simulated-gambling ads and other ad categories
        unsuitable for young people across the whole site. Until then no ad code loads.
      </p>

      <LegalHeading id="storage">11. Cookies, similar technologies and ads</LegalHeading>
      <p>
        We store a few things in your browser that the site needs to work. They are strictly necessary, so they need no
        consent:
      </p>
      <LegalTable
        head={["What", "Why", "How long"]}
        rows={[
          ["Sign-in tokens (accessToken, refreshToken) and a cached copy of your profile (nba3via-session-user)", "Keep you signed in and load the page signed in", "Until you sign out; a sign-in lasts 90 days at most"],
          ["A random device code (nba-mg:wordle-device-id)", "The one-play-a-day limit on Wordle and LeContexto for guests", "Until you clear it"],
          ["Your theme (nba3via-theme), the profile or friends tab you last used (sq:profile-view) and the position of the game strip (sq:rail-strip-x, this tab only)", "Remember settings you chose", "Until you clear them; the strip position until you close the tab"],
          ["Cached game data, player pools and questions (gamedata:…, pool:…, questions:…)", "Start games quickly and play offline", "Until the data is updated"],
          ["Questions you have already been shown (seen:…)", "So you don't get the same question twice", "Until you clear them"],
          ["Points you scored as a guest (sq:guest-points, this tab only)", "Add them to a new account if you sign up in the same visit", "Until you close the tab"],
        ]}
      />
      <p>
        <strong>Ads (not live yet).</strong> No ad code loads today, so none of the cookies below is set. When we switch
        ads on, Google, which will show the ads, will set or read the cookies below. In the EEA, the UK and Switzerland a
        message will ask you first: advertising cookies are set only if you choose &ldquo;Consent&rdquo; or allow them
        under &ldquo;Manage options&rdquo;. If you choose &ldquo;Do not consent&rdquo; you still see ads, but basic ones
        (&ldquo;limited ads&rdquo;) that use no advertising cookies; Google may still use a cookie or browser storage only
        to detect fraudulent ad traffic. Your choice itself is stored in a cookie. The list is Google&apos;s; which cookies
        you actually get depends on your choices and on the ad partners you allow (their cookies will be listed in
        Privacy and cookie settings &rarr; Manage options &rarr; Vendors). We will check the list against what the ads
        actually set before we switch them on.
      </p>
      <LegalTable
        head={["Cookie", "Set by", "What it is for", "How long"]}
        rows={[
          ["FCCDCF", "Google (privacy message)", "Remembers your cookie and ad choices", "13 months"],
          ["FCNEC", "Google (privacy message)", "Measures how the privacy message works", "1 year"],
          ["__gads, __gpi", "Google AdSense, on our site", "Show and measure ads, limit repeats, prevent fraud", "13 months"],
          ["__gpi_optout", "Google AdSense, on our site", "Remembers that you turned off this type of ad cookie", "13 months"],
          ["__eoi", "Google AdSense, on our site", "Security and fraud prevention for ads", "6 months"],
          ["IDE, id", "Google (doubleclick.net)", "Choose ads based on your browsing (IDE); remember that you turned personalised ads off (id)", "13 months in the EEA, UK and Switzerland, 24 months elsewhere"],
          ["DSID", "Google (doubleclick.net)", "Respect your Google ad settings if you are signed in to Google", "2 weeks"],
          ["test_cookie, TESTCOOKIESENABLED", "Google", "Check that your browser accepts cookies", "15 minutes; 60 seconds"],
        ]}
      />
      <p>
        Once ads are on, open <strong>Privacy and cookie settings</strong> at the bottom of any page to change your
        choice. You can also clear or block cookies and site data in your browser settings; clearing our site data signs
        you out. Blocking Google&apos;s ad domains in a content blocker hides the ads and does not stop the games working.
      </p>

      <LegalHeading id="security">12. Security</LegalHeading>
      <p>
        Passwords are stored only as salted hashes; connections use HTTPS; sign-in sessions are short-lived and can be revoked;
        sign-in attempts are rate-limited; access to personal data is limited to the operator and people they authorise; and we keep as little as the service
        needs. If a breach puts your data at risk we will tell the authorities and, where required, you, within the time the
        law sets.
      </p>

      <LegalHeading id="us">13. Notice for California and other US states</LegalHeading>
      <p>
        We collect the categories in section 2 for the purposes given there. We do not sell personal information, do not
        share it for cross-context behavioural advertising, and do not use or disclose sensitive personal information to
        infer anything about you. Ads (not live yet): when we switch ads on, ads shown to visitors in the United States
        will not be based on your browsing: we will ask Google to apply its &ldquo;restricted data processing&rdquo; to
        them, so we still will not sell personal information or share it for cross-context behavioural advertising, and we
        will honour Global Privacy Control signals: Google receives them from your browser and limits ads accordingly. You
        can request access, deletion and correction as described in section 8, and we will not treat you differently for
        doing so. We do not respond to &ldquo;Do Not Track&rdquo; signals, which have no agreed meaning.
      </p>

      <LegalHeading id="where">14. Where the service is available</LegalHeading>
      <p>
        The service is offered worldwide, but it is not directed at, and may not be used from, the Russian Federation or
        countries and regions under comprehensive international sanctions.
      </p>

      <LegalHeading id="changes">15. Changes to this policy</LegalHeading>
      <p>
        When we change this policy we update the date at the top and describe what changed. For a significant change we
        will also say so on the site&apos;s home page for at least 14 days before it applies. Earlier versions are available
        on request.
      </p>
      <p>
        This version was published on {LEGAL.updated}. It applies straight away to accounts created from that date, which
        accept it at sign-up. For accounts created before, it applies from {LEGAL.changeNotice.effective}.
      </p>
    </LegalPage>
  );
}
