import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import "../styles/Leaderboard.css"
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import type { User } from '../types/types';
import { BACKEND_URL } from '../configurations/backend';
import { apiFetch } from '../utils/Api';
import Spinner from './motion/Spinner';
import MotionButton from './motion/MotionButton';
import { staggerContainer, staggerItem } from '../motion/variants';



type LeaderboardState = {
    isLoading: boolean,
    error: boolean,
    users: User[],
    total_users: number,
    user_rank: number
}


function Leaderboard() {
    const { user } = useSelector((state: RootState) => state.user);


    const [leaderboardState, setLeaderboardState] = useState<LeaderboardState>({
        isLoading: true,
        error: false,
        users: [],
        total_users: 0,
        user_rank: -1
    });


    const getUsers = async () => {
        setLeaderboardState(prev => ({ ...prev, isLoading: true, error: false }));
        try {
            const response = await apiFetch(`${BACKEND_URL}/get-users/`);
            const data = await response.json();
            if (data.error) {
                setTimeout(() => {
                    setLeaderboardState(prev => ({
                        ...prev,
                        error: true,
                        isLoading: false,
                        users: []
                    }));
                }, 1200)
            } else {
                setTimeout(() => {
                    setLeaderboardState(prev => ({
                        ...prev,
                        users: data.top_100_users || [],
                        error: false,
                        isLoading: false,
                        total_users: data.number_users,
                        user_rank: data.user_rank
                    }))
                }, 1200)
            }
        } catch (err) {
            console.error("Failed to load leaderboard:", err);
            setLeaderboardState(prev => ({ ...prev, error: true, isLoading: false, users: [] }));
        }
    }

    useEffect(() => {
        getUsers();
    }, []);

    return (
        <div>
            <h2 className='font-display text-2xl sm:text-3xl mb-2 gradient-orange'>TOP 100 Global Leaderboard</h2>
            <div className="leaderboard-wrapper">
                <AnimatePresence mode="wait">
                    {leaderboardState.isLoading ? (
                        <motion.div
                            key="loader"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}
                        >
                            <Spinner size={44} />
                        </motion.div>
                    ) : leaderboardState.error ? (
                        <motion.p key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            Failed to retrieve leaderboard
                        </motion.p>
                    ) : (
                        <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <table
                                className="leaderboard-table"
                                style={{
                                    borderCollapse: "collapse",
                                    borderRadius: "24px",
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
                                style={{
                                    maxHeight: "240px",
                                    overflowY: "auto",
                                    borderTop: "none",
                                }}>

                                <motion.table
                                    key={leaderboardState.users.length}
                                    className="leaderboard-data-table"
                                    style={{ borderCollapse: "collapse" }}
                                    variants={staggerContainer}
                                    initial="hidden"
                                    animate="visible"
                                >
                                    <tbody>
                                        {leaderboardState.users.map((currentUser: User, index) => (
                                            <motion.tr
                                                key={index}
                                                variants={staggerItem}
                                                className={user && currentUser.username === user.username ? "highlighted-row" : ""}
                                            >
                                                <td className="tnum">{index + 1}</td>
                                                <td>{currentUser.username}</td>
                                                <td className="tnum">{currentUser.points}</td>
                                            </motion.tr>
                                        ))}
                                    </tbody>
                                </motion.table>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {user && !leaderboardState.isLoading ? <p className='mt-4 sm:mt-1'>Your rank: {leaderboardState.user_rank}/{leaderboardState.total_users}</p> : ""}
            <MotionButton onClick={getUsers} style={{ marginTop: "20px" }}>Refresh</MotionButton>

        </div>
    )
}

export default Leaderboard
