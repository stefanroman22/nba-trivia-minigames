import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXTwitter, faLinkedinIn, faInstagram, faFacebookF } from "@fortawesome/free-brands-svg-icons";
import { faArrowUp } from "@fortawesome/free-solid-svg-icons";
import logo from "../assets/basketballLogo.webp"
import { navItems } from "../constants/navigation";
import { legalItems } from "../constants/legals";



export default function Footer() {

  return (
    <footer className="bg-[#292929] text-white py-10 px-6 flex flex-col justify-between md:gap-8 md:px-16 md:flex-row gap-8">

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 max-w-md">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Logo" className="w-8 h-8" />
            <h2 className="text-lg font-semibold tracking-wider">NBA Trivia Minigames</h2>
          </div>
          <p className="text-gray-300 text-sm leading-relaxed">
            Test your NBA knowledge with our fast-paced trivia minigames — guess playoff winners, relive legendary moments, and climb the leaderboard to prove you’re the ultimate basketball fan!
          </p>
        </div>

        {/* Social icons */}
        <div className="flex items-center gap-5 text-gray-300 text-lg">
          <FontAwesomeIcon icon={faXTwitter} className="hover:text-white transition" />
          <FontAwesomeIcon icon={faLinkedinIn} className="hover:text-white transition" />
          <FontAwesomeIcon icon={faInstagram} className="hover:text-white transition" />
          <FontAwesomeIcon icon={faFacebookF} className="hover:text-white transition" />
        </div>

        {/* Back to top button */}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center gap-2 border border-gray-500 px-4 py-2 text-sm uppercase tracking-wide  transition duration-300"
          onMouseEnter={(e) => (e.currentTarget.style.background = "#ea750e")} // orange
          onMouseLeave={(e) => (e.currentTarget.style.background = "")}
        >
          <FontAwesomeIcon icon={faArrowUp} />
          Back to top
        </button>
      </div>
      <div className="flex gap-8">

        <div className="flex flex-col">
          <h1 className="mb-4">Site Map</h1>
          {navItems.map((item) => {
            return (
              <a
                key={item}
                href={`#${item.toLowerCase().replace(" ", "")}`}

                className="text-white hover:underline transition duration-500 mb-2"
              >
                {item}
              </a>
            );
          })}
        </div>

        <div className="flex flex-col">
          <h1 className="mb-4">Legal</h1>
          {legalItems.map((item) => {
            return (
              <a
                key={item}
                href={`#${item.toLowerCase().replace(" ", "")}`}

                className="text-white hover:underline transition duration-500 mb-2"
              >
                {item}
              </a>
            );
          })}
        </div>
      </div>



    </footer>
  );
}

