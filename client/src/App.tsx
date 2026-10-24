import { useEffect, useState } from "react";
import { socket } from "./socket";
import "./App.css";

function App() {
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return (
    <div className="app">
      <h1>skribbl</h1>
      <p>{connected ? `Connected: ${socket.id}` : "Disconnected"}</p>
    </div>
  );
}

export default App;
