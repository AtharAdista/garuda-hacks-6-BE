// import { Server, Socket } from "socket.io";
// import { prismaClient } from "../app/database";
// import { rooms } from "../type/room";

// export async function broadcastRoomData(io: Server, roomId: string, immediateSocket?: Socket) {
//   const room = rooms.get(roomId);
//   if (!room) return;

//   const playerIds = Array.from(room.players.keys());

//   const users = await prismaClient.userAccount.findMany({
//     where: { id: { in: playerIds } },
//     select: { id: true, username: true },
//   });

//   const players = Array.from(room.players.entries()).map(
//     ([userId, player], index) => {
//       const user = users.find((u) => u.id === userId);

//       return {
//         id: userId,
//         username: user?.username,
//         health: player.health,
//       };
//     }
//   );

//   const roomData = { players };

//   // Emit to the immediate socket first (guarantees delivery)
//   if (immediateSocket) {
//     immediateSocket.emit("roomData", roomData);
//   }

//   // Then broadcast to all others in room
//   io.to(roomId).emit("roomData", roomData);
// }