import type { Metadata } from "next";
import { LEGAL } from "../../configurations/legal";
import { SITE_NAME } from "../../configurations/site";
import LegalPage, { LegalHeading, LegalList, LegalSummary, LegalTable, MailLink, OperatorBlock } from "../../components/LegalPage";

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
    <LegalPage title="Privacy Policy">
      <LegalSummary>
        <strong>The short version.</strong>
        <LegalList>
          <li>You can play without an account, and then we do not keep your name or email.</li>
          <li>An account stores your email, a display name, your scores and the things you choose to add (friends, and later a photo). Your display name, player ID, rank and points are visible to other players (players aged 13 to 15 are not shown on the public leaderboard). Your email is never shown.</li>
          <li>There are no ads, no analytics and no tracking cookies. We never sell your data.</li>
          <li>You can download everything we hold and delete your account yourself, from your profile.</li>
          <li>Accounts are for people aged {LEGAL.minimumAge} and over.</li>
        </LegalList>
      </LegalSummary>

      <LegalHeading id="who">1. Who we are</LegalHeading>
      <p>
        {LEGAL.service} (previously {LEGAL.formerName}) is a free NBA trivia website. The person or company below is the
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
          ["Playing as a guest: answers you submit to questions (no name, no email), and a random device code in your browser used to give each device one Wordle a day", "Question statistics (for example how fans answer Fan Favorites); the daily Wordle limit", "Legitimate interests", "Answers: 12 months. Wordle plays: removed after the day ends. The device code stays in your browser until you clear it."],
          ["Account details: email, display name, public player ID, a hash of your password (never the password), or your Google account ID", "Sign you in and run your account", "Contract", "Until you delete the account"],
          ["Points and rank", "Leaderboards and matchmaking", "Contract", "Until you delete the account"],
          ["Consent record: the Terms version you accepted, when, and that you confirmed the age requirement (we do not keep your birth date)", "Prove the account was opened properly", "Legitimate interests and legal obligation", "Until you delete the account"],
          [`Profile photo (optional, only for players aged ${LEGAL.photoMinimumAge} and over), resized to 256x256. Photo upload is switched off until our automatic photo check is live; this row applies from then`, "Show your photo to other players", "Consent: you choose to add it and can remove it any time", "Until you remove it or delete the account"],
          ["Friends, friend requests and blocked players", "Friends features", "Contract", "Until you remove them or delete the account"],
          ["Game history (game, score, time) and your own answers", "Your record, and fair play", "Contract", "Game history: 24 months. Answers: 12 months."],
          ["Feedback you send (rating, message, page, and your email and name if you are signed in)", "Improve the service and reply to you", "Legitimate interests", "Until handled; resolved feedback is deleted after 12 months, and with your account"],
          ["Moderation records: strikes, a reason code (never the offending text), and a one-way hash of your network address", "Enforce the rules and stop repeat abuse", "Legitimate interests", "The events and the address hash: 12 months (or while a ban stands). The strike count and ban status are part of your account and stay while it exists. See section 7 for banned accounts."],
          ["Rate-limit counters (your IP address, in our database)", "Stop sign-in guessing and request flooding", "Legitimate interests", "About an hour"],
          ["Server logs kept by our hosting provider (IP address, time, address requested)", "Security and keeping the service running", "Legitimate interests", "A short period set by the provider"],
          ["Multiplayer: while you play online, your display name, ID, rank, points and photo are held in a game server's memory", "Run the match", "Contract", "Until the match ends; not stored"],
        ]}
      />
      <p>
        If you do not give us the account details above we cannot create an account, but you can still play as a guest.
      </p>

      <LegalHeading id="public">3. What other people can see</LegalHeading>
      <LegalList>
        <li><strong>Everyone</strong> who opens the site can see leaderboard rows: display name, player ID, rank, points and photo (if you added one).</li>
        <li><strong>Other players</strong> can find you by name or player ID, see your photo, and send a friend request; online opponents see your name, ID, rank, points and photo during a match.</li>
        <li><strong>Nobody else</strong> sees your email, your game history, your answers or your feedback. Only the operator, and anyone the operator authorises to run the service, can read those.</li>
      </LegalList>
      <p>Please do not use your real name as your display name, and do not upload a photo you do not want others to see.</p>

      <LegalHeading id="google">4. Sign in with Google</LegalHeading>
      <p>
        If you choose it, Google tells us your email address and a stable ID for your Google account. We do not receive your
        Google password and we read nothing else from your Google account. We use that information only to create and sign
        you in to your {LEGAL.service} account. We do not sell it, do not use it for advertising and do not transfer it to
        anyone except our service providers listed below, and only as needed to run your account. Google&apos;s sign-in
        window loads only when you open the login box and is run by Google under its own privacy policy. Our use of
        information received from Google APIs follows the Google API Services User Data Policy, including its Limited Use
        requirements.
      </p>

      <LegalHeading id="shared">5. Who handles your data for us</LegalHeading>
      <LegalTable
        head={["Provider", "What it does", "Where"]}
        rows={[
          ["Vercel", "Hosts the website and the account server (and will host our automatic photo check)", "Global network; the account server runs in Frankfurt, Germany"],
          ["Supabase", "Hosts the database that holds your account and game data", "Frankfurt, Germany (EU)"],
          ["GitHub", "Stores our code and runs scheduled maintenance jobs (such as the weekly clean-up) that connect to the database", "United States and global"],
          ["Railway", "Runs the real-time game server for online matches (it holds match data in memory only)", "Amsterdam, Netherlands (EU)"],
          ["Google", "Runs the sign-in window and holds your Google account, as its own controller", "Worldwide"],
        ]}
      />
      <p>
        The operator also uses development tools, including AI-assisted ones, to build and maintain the service. They may be
        given access to the systems above for maintenance only.
      </p>
      <p>
        These providers act on our instructions under data processing terms. Separately, some pictures are loaded straight
        from other websites: team logos and player photos from <strong>cdn.nba.com</strong> and some logos from{" "}
        <strong>upload.wikimedia.org</strong>. Your browser asks those servers directly, so they can see your IP address and
        browser details, as with any image on the web. We do not use Google Fonts or any analytics or advertising service.
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
        providers&apos; data processing terms. You can ask us for a copy of the relevant safeguard.
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
        <li><strong>Withdraw consent</strong> (for your photo) at any time, by removing it.</li>
      </LegalList>
      <p>
        If you cannot use those buttons (for example your account is banned), write to <MailLink />. We answer within one
        month. We may ask you to confirm it is you by replying from the account&apos;s email address. If you are in the EU,
        the UK or another country with similar rights, you can also complain to your data protection authority.
      </p>

      <LegalHeading id="automated">9. Automated checks</LegalHeading>
      <p>
        Display names are checked automatically against a word list. Photos will be checked by an automatic image classifier
        on our own service before they are shown, and the classifier does not keep the picture; until that check is live,
        photo upload is switched off. A name or photo that is clearly not allowed is refused and counts as a
        strike (strikes do not expire); the third strike bans the account. Nothing else about you is profiled or scored. You can ask a person to
        review any strike or ban, and tell us your side, by writing to <MailLink /> (see the Terms, section 7).
      </p>

      <LegalHeading id="children">10. Age and children</LegalHeading>
      <p>
        Accounts are only for people aged {LEGAL.minimumAge} or over. When you sign up we ask for your birth month and year
        to check this, and we do not store them: we keep only that the check passed and whether you are under or over{" "}
        {LEGAL.photoMinimumAge}. Players under {LEGAL.photoMinimumAge} cannot add a profile photo. If we learn that an
        account belongs to someone younger than {LEGAL.minimumAge}, we delete it.
        Anyone can play as a guest, and a guest&apos;s answers are not tied to a person. Parents and guardians can write to{" "}
        <MailLink /> to ask us to remove a child&apos;s data.
      </p>

      <LegalHeading id="storage">11. Cookies and similar technologies</LegalHeading>
      <p>
        We do not use advertising or analytics cookies. We store a few things in your browser, all of them needed for the
        service to work, so there is no consent banner:
      </p>
      <LegalList>
        <li>your sign-in tokens, and a cached copy of your profile so the page loads signed in;</li>
        <li>a random device code, used for the one-Wordle-a-day limit for guests;</li>
        <li>your theme choice and cached game data so games start quickly;</li>
        <li>a short note (24 hours) if a sign-up age check fails, so the same browser does not retry with another date.</li>
      </LegalList>
      <p>You can clear all of it in your browser settings; you will be signed out.</p>

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
        infer anything about you. You can still request access, deletion and correction as described in section 8, and we
        will not treat you differently for doing so. We do not respond to &ldquo;Do Not Track&rdquo; signals because we do
        not track you.
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
    </LegalPage>
  );
}
