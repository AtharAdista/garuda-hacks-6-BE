import {
  CreateUserRequest,
  CreateUserResponse,
  GetUserResponse,
  LoginUserRequest,
  LoginUserResponse,
} from "../model/user-model";
import bcrypt from "bcrypt";
import { ResponseError } from "../error/error-response";
import jwt from "jsonwebtoken";
import { prismaClient } from "../app/database";
import { UserAccount } from "@prisma/client";
import { UserRequest } from "../type/user-request";

const JWT_SECRET = process.env.JWT_SECRET || "ajsaknsaksaksk1201";

export class UserService {
  static async register(
    request: CreateUserRequest
  ): Promise<CreateUserResponse> {
    let user = await prismaClient.userAccount.findFirst({
      where: {
        email: request.email,
      },
    });

    if (user) {
        throw new ResponseError(409, "email already exist")
    }

    request.password = await bcrypt.hash(request.password, 10);

    user = await prismaClient.userAccount.create({
      data: request,
    });

    return {
      username: user.username,
    };
  }

  static async login(request: LoginUserRequest): Promise<LoginUserResponse> {
    let user = await prismaClient.userAccount.findFirst({
      where: {
        email: request.email,
      },
    });

    if (!user) {
      throw new ResponseError(401, "email or password is invalid");
    }

    const passwordMatch = await bcrypt.compare(request.password, user.password);

    if (!passwordMatch) {
      throw new ResponseError(401, "email or password is invalid");
    }

    const token = jwt.sign({ userid: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "24h",
    });

    return {
      token: token,
    };
  }

  static async get(user: GetUserResponse): Promise<GetUserResponse>{
    console.log(user)
    return {
        id: user.id,
        email: user.email
    }
  }
}

