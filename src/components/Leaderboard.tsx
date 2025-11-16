import { useEffect, useState } from 'react'
import "../styles/Leaderboard.css"
import { buttonStyle, handleMouseEnter, handleMouseLeave } from '../constants/styles'
import { useSelector} from "react-redux";
import type { RootState } from "../store";
import type { User } from '../types/types';
import { BACKEND_URL } from '../configurations/backend';





function Leaderboard() {
    const { user } = useSelector((state: RootState) => state.user);

    const [isLoading, setIsLoading] = useState(true);
    const [leaderboardError, setLeaderboardError] = useState(false);
    const [usersData, setUsersData] = useState([]);


    const getUsers = async () => {
        setIsLoading(true);
        const response = await fetch(`${BACKEND_URL}/get-users/`, {
            method: "GET",
            credentials: "include", // very important
            headers: {
                "Content-Type": "application/json",
            },
        })
        const data = await response.json();
        console.log(BACKEND_URL);
        if (data.error) {
            setTimeout(() => {
                setLeaderboardError(true);
                setIsLoading(false);
            }, 1500)
        } else {
            setTimeout(() => {
                setUsersData(data.users);
                setIsLoading(false);
                setLeaderboardError(false);
            }, 1500)

        }
    }

    useEffect(() => {
        console.log("BACKEND_URL:", BACKEND_URL);
console.log("ENV raw:", import.meta.env.VITE_BACKEND_URL);
        getUsers();
    }, []);
    let userIndex = -1;
    if (user != null)
        userIndex = usersData.findIndex((u: User) => u.username === user.username) + 1;
    return (
        <div>
            <h2 className='text-2xl font-bold mb-2 gradient-orange'>TOP 100 Global Leaderboard</h2>
            <div className="leaderboard-wrapper">
                {
                    isLoading ? <div className="loader" /> : (leaderboardError ? <p>Failed to retrieve leaderboard</p> :

                        <>
                            <table
                                className="leaderboard-table"
                                style={{
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    borderRadius: "24px",
                                    boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
                                    overflow: "hidden",
                                }}
                            >
                                <thead>
                                    <tr style={{ backgroundColor: "rgba(255, 122, 0, 0.4)" }}>
                                        <th style={{ padding: "10px 15px", fontWeight: "bold", textAlign: "center" }}>Rank</th>
                                        <th style={{ padding: "10px 15px", fontWeight: "bold", textAlign: "center" }}>Username</th>
                                        <th style={{ padding: "10px 15px", fontWeight: "bold", textAlign: "center" }}>Points</th>
                                    </tr>
                                </thead>
                            </table>

                            <div
                                className='leaderboard-wrapper'
                                style={{
                                    maxHeight: "200px",
                                    overflowY: "auto",
                                    borderTop: "none", borderCollapse: "collapse"
                                }}>

                                <table className="leaderboard-data-table" style={{ width: "100%", border: "1px", borderRadius: "24px", borderCollapse: "collapse" }}>
                                    <tbody>
                                        {usersData.map((currentUser: User, index) => (
                                            <tr key={index}>
                                                <td>{index + 1}</td>
                                                <td>{currentUser.username}</td>
                                                <td>{currentUser.points}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>)}
            </div>

            {user && !isLoading ? <p className='mt-4 sm:mt-1'>Your rank: {userIndex}/{usersData.length}</p> : ""}
            <button onClick={getUsers} style={{ ...buttonStyle, marginTop: "20px" }} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>Refresh</button>

        </div>
    )
}

export default Leaderboard
