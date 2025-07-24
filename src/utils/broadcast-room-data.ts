import { Server } from "socket.io";
import { prismaClient } from "../app/database";
import { rooms } from "../type/room";

export async function broadcastRoomData(io: Server, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const playerIds = Array.from(room.players.keys());

  const users = await prismaClient.userAccount.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, username: true },
  });

  const players = Array.from(room.players.entries()).map(
    ([userId, player], index) => {
      const user = users.find((u) => u.id === userId);

      return {
        id: userId,
        username: user?.username,
        health: player.health,
      };
    }
  );

  io.to(roomId).emit("roomData", { players });
}
