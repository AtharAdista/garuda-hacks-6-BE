
import "dotenv/config"
import http from "http";
import { app } from "./app/web";
import { initializeSocket } from "./socket/socket";


const port = process.env.PORT;

const server = http.createServer(app);

initializeSocket(server)

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
