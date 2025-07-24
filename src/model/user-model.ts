export type CreateUserRequest = {
  username: string;
  email: string;
  password: string;
};

export type LoginUserRequest = {
  email: string;
  password: string;
};

export type CreateUserResponse = {
  username: string;
};

export type LoginUserResponse = {
  token: string;
};

export type GetUserResponse = {
  id: string;
  email: string;
};
