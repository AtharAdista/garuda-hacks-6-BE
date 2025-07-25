import { UserAccount } from "@prisma/client";
import { Request } from "express";

export interface UserRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}
