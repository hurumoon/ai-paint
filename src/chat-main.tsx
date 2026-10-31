import React from "react";
import ReactDOM from "react-dom/client";
import { ChatWindowApp } from "./components/ChatWindowApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ChatWindowApp />
  </React.StrictMode>
);
