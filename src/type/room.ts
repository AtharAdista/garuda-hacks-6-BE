export type Player = {
  socketId: string;
  userId: string;
  health: number;
};

export type Room = {
  id: string;
  players: Map<string, Player>;
};

export const rooms = new Map<string, Room>();
