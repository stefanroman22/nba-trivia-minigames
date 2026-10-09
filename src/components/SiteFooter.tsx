import Link from "next/link";
import { visibleGames } from "../utils/GameUtils";
import { legalLinks } from "../constants/legals";
import { FORMER_NAME, SITE_NAME } from "../configurations/site";
import { LEGAL } from "../configurations/legal";
import "../styles/SiteFooter.css";

/** Site-wide footer: real links to every game and the legal pages (crawlable internal links), the
 *  former brand name, and the non-affiliation line. Server-rendered, no client state. */
export default function SiteFooter() {
  const games = visibleGames.filter((g) => g.id !== "coming-soon");
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <p className="font-display site-footer-name">{SITE_NAME}</p>
          <p className="site-footer-note">
            Free NBA trivia games. Formerly {FORMER_NAME}. Not affiliated with or endorsed by the NBA or any team.
          </p>
        </div>
        <nav className="site-footer-col" aria-label="Games">
          <p className="site-footer-head">Games</p>
          <ul>
            {games.map((g) => (
              <li key={g.id}><Link href={g.urlPath}>{g.name}</Link></li>
            ))}
          </ul>
        </nav>
        <nav className="site-footer-col" aria-label="Legal">
          <p className="site-footer-head">Legal</p>
          <ul>
            {legalLinks.map((item) => (
              <li key={item.href}><Link href={item.href}>{item.label}</Link></li>
            ))}
            <li><a href={`mailto:${LEGAL.contactEmail}`}>Contact</a></li>
          </ul>
        </nav>
      </div>
      <p className="site-footer-copy">© {new Date().getFullYear()} {SITE_NAME}</p>
    </footer>
  );
}
