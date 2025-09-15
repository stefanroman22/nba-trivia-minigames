// src/PlayWithFriend.js
import React, { useEffect, useState } from "react";
import socket from "../../socket";

export default function PlayWithFriend() {
  const [status, setStatus] = useState("disconnected");

  useEffect(() => {
    // connected
    socket.on("connect", () => {
      console.log("Connected to server:", socket.id);
      setStatus("connected");
    });

    // disconnected
    socket.on("disconnect", () => {
      console.log("Disconnected from server");
      setStatus("disconnected");
    });

    // cleanup on unmount
    return () => {
      socket.off("connect");
      socket.off("disconnect");
    };
  }, []);

  return (
    <div>
      <h2>Play with Friend</h2>
      <p>Status: {status}</p>
    </div>
  );
}