import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { publicApi } from "../router/public-api";
import { apiRouter } from "../router/api";
import { errorMiddleware } from "../middleware/error-middleware";

export const app = express();

app.use(cors())
app.use(express.json());
app.use(publicApi);
app.use(apiRouter);
app.use(errorMiddleware);


