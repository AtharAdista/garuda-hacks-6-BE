import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UserRequest } from "../type/user-request";

const JWT_SECRET = process.env.JWT_SECRET || "ajsaknsaksaksk1201";


export function authenticateToken(
  req: UserRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers["authorization"];

  const token = authHeader?.split(" ")[1]; // ambil token-nya

  if (!token) return res.status(401).json({ message: "Token not provided" });

  jwt.verify(token, JWT_SECRET, (err, decoded: any) => {
    if (err) return res.status(403).json({ message: "Invalid token" });


    req.user = {
      id: decoded.userid,
      email: decoded.email,
    };


    next();
  });
}
