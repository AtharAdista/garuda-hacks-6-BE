import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { publicApi } from "../router/public-api";
import { apiRouter } from "../router/api";
import { errorMiddleware } from "../middleware/error-middleware";

const app = express();
export const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("hello", (data) => {
    console.log("Received:", data);
    socket.emit("welcome", "Hello back!");
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

app.use(cors());
app.use(express.json());
app.use(publicApi);
app.use(apiRouter);
app.use(errorMiddleware);

app.get("/", (_req, res) => {
  res.send("Socket.IO Server Running");
});
