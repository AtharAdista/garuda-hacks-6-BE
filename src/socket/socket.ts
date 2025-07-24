import { Server } from "socket.io";
import http from "http";
import { prismaClient } from "../app/database";
import { Room, rooms } from "../type/room";

const gameSubmissions: Record<string, Record<string, any>> = {};

export function initializeSocket(server: http.Server) {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("createRoom", async ({ roomId, userId }) => {
      try {
        const newRoom = await prismaClient.gameRoom.create({
          data: {
            code: roomId,
            mode: "player_vs_player",
            status: "waiting",
          },
        });

        await prismaClient.gameRoomParticipant.create({
          data: {
            game_room_id: newRoom.id,
            user_id: userId,
          },
        });

        const room: Room = {
          id: roomId,
          players: new Map([
            [userId, { socketId: socket.id, userId, health: 3 }],
          ]),
        };
        rooms.set(roomId, room);

        socket.join(roomId);
        console.log(`Room ${roomId} created by ${userId}`);
        socket.emit("roomCreated", { roomId, userId, health: 3 });

        // Send initial room data to the creator
        const playersData: Record<string, any> = {};
        room.players.forEach((player, userId) => {
          playersData[userId] = {
            socketId: player.socketId,
            userId: player.userId,
            health: player.health,
          };
        });

        socket.emit("roomData", {
          roomId,
          players: playersData,
          playerCount: room.players.size,
        });
      } catch (error) {
        console.error("Error creating room:", error);
        socket.emit("error", { message: "Failed to create room" });
      }
    });

    // Handle room joining
    socket.on("joinRoom", async ({ roomId, userId }) => {
      let room = rooms.get(roomId);

      if (!room) {
        try {
          const gameRoom = await prismaClient.gameRoom.findUnique({
            where: { code: roomId },
          });

          if (!gameRoom) {
            socket.emit("error", "Room not found");
            return;
          }

          room = {
            id: roomId,
            players: new Map(),
          };

          rooms.set(roomId, room);
          console.log(`Room ${roomId} loaded from DB`);
        } catch (err) {
          console.error("Database error during room creation:", err);
          socket.emit("error", "Internal server error");
          return;
        }
      }

      if (room.players.has(userId)) {
        socket.emit("error", "User already in room");
        return;
      }

      if (room.players.size >= 2) {
        socket.emit("error", "Room is full");
        return;
      }

      room.players.set(userId, { socketId: socket.id, userId, health: 3 });
      socket.join(roomId);

      console.log(`User ${userId} joined room ${roomId}`);
      socket.emit("joinedRoom", { roomId, userId, health: 3 });

      const playersData: Record<string, any> = {};
      room.players.forEach((player, userId) => {
        playersData[userId] = {
          socketId: player.socketId,
          userId: player.userId,
          health: player.health,
        };
      });

      io.to(roomId).emit("roomData", {
        roomId,
        players: playersData,
        playerCount: room.players.size,
      });

      console.log(`Broadcasted room data to all users in room ${roomId}`);

      try {
        const gameRoom = await prismaClient.gameRoom.findUnique({
          where: { code: roomId },
        });

        if (!gameRoom) {
          console.error("GameRoom not found in DB");
          return;
        }

        const existingParticipant =
          await prismaClient.gameRoomParticipant.findFirst({
            where: {
              game_room_id: gameRoom.id,
              user_id: userId,
            },
          });

        if (!existingParticipant) {
          await prismaClient.gameRoomParticipant.create({
            data: {
              game_room_id: gameRoom.id,
              user_id: userId,
            },
          });
        }
      } catch (err) {
        console.error("Database error on joinRoom:", err);
      }
    });

    // PINDAHKAN KELUAR DARI requestRoomData - Handler province selection (for real-time preview)
    socket.on("selectProvince", ({ roomId, province, userId }) => {
      console.log(`User ${userId} selecting province: ${province.name} in room ${roomId}`);
      // Broadcast ke pemain lain di room untuk preview real-time
      socket.to(roomId).emit("provinceSelected", { province, userId });
    });

    // Handle room data request
    socket.on("requestRoomData", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      // Convert Map to plain object for transmission
      const playersData: Record<string, any> = {};
      room.players.forEach((player, userId) => {
        playersData[userId] = {
          socketId: player.socketId,
          userId: player.userId,
          health: player.health,
        };
      });

      console.log(`Sending room data for ${roomId}:`, playersData);
      socket.emit("roomData", {
        roomId,
        players: playersData,
        playerCount: room.players.size,
      });
    });

    // Handle room rejoin
    socket.on("rejoinRoom", ({ roomId, userId }) => {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      const player = room.players.get(userId);
      if (!player) {
        socket.emit("error", "User not part of room");
        return;
      }

      player.socketId = socket.id;
      socket.join(roomId);
      socket.emit("roomRejoined", {
        roomId,
        userId,
        health: player.health,
      });
      console.log(
        `${userId} rejoined room ${roomId} with health ${player.health}`
      );
    });

    // Handle leaving room
    socket.on("leaveRoom", ({ roomId, userId }) => {
      const room = rooms.get(roomId);
      if (room && room.players.has(userId)) {
        room.players.delete(userId);
        socket.leave(roomId);
        console.log(`${userId} left room ${roomId}`);

        // Clean up game submissions for this room if player leaves
        if (gameSubmissions[roomId]) {
          delete gameSubmissions[roomId][userId];
          if (Object.keys(gameSubmissions[roomId]).length === 0) {
            delete gameSubmissions[roomId];
          }
        }

        // Notify other players in the room about someone leaving
        io.to(roomId).emit("playerLeft", { userId });

        // Broadcast updated room data to remaining users
        const playersData: Record<string, any> = {};
        room.players.forEach((player, userId) => {
          playersData[userId] = {
            socketId: player.socketId,
            userId: player.userId,
            health: player.health,
          };
        });

        io.to(roomId).emit("roomData", {
          roomId,
          players: playersData,
          playerCount: room.players.size,
        });

        // If room is empty, you might want to delete it
        if (room.players.size === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted - no players remaining`);
        }
      }
    });

    socket.on("startGame", ({ roomId }) => {
      console.log(`Game started in room: ${roomId}`);
      
      // Reset game submissions when starting new game
      if (gameSubmissions[roomId]) {
        delete gameSubmissions[roomId];
      }
      
      io.to(roomId).emit("gameStarted", {}); // broadcast ke semua dalam room
    });

    // PERBAIKAN UTAMA - Handle province submission (final answer)
    socket.on("submitProvince", ({ province, userId, roomId }) => {
      console.log(`User ${userId} submitted province:`, province.name, "in room:", roomId);
      
      // Get room info first to validate
      const room = rooms.get(roomId);
      if (!room) {
        console.error(`Room ${roomId} not found when user ${userId} submitted`);
        socket.emit("error", "Room not found");
        return;
      }

      // Initialize room submissions if not exists
      if (!gameSubmissions[roomId]) {
        gameSubmissions[roomId] = {};
      }
      
      // Store the submission
      gameSubmissions[roomId][userId] = province;
      console.log(`Stored submission for user ${userId}:`, province.name);
      console.log(`Current submissions in room ${roomId}:`, Object.keys(gameSubmissions[roomId]));
      
      // Broadcast ke opponent bahwa user ini sudah submit (dengan jawabannya)
      socket.to(roomId).emit("opponentSubmitted", { 
        userId, 
        province 
      });
      console.log(`Broadcasted opponentSubmitted to room ${roomId}`);
      
      const totalPlayers = room.players.size;
      const submittedCount = Object.keys(gameSubmissions[roomId]).length;
      
      console.log(`Room ${roomId}: ${submittedCount}/${totalPlayers} players submitted`);
      
      // Cek apakah semua player dalam room sudah submit
      if (submittedCount === totalPlayers) {
        // Semua player sudah submit, kirim hasil lengkap
        const results = Object.entries(gameSubmissions[roomId]).map(([uid, prov]) => ({
          userId: uid,
          province: prov
        }));
        
        console.log(`All players submitted in room ${roomId}, sending results:`, results);
        io.to(roomId).emit("showResults", { results });
        
        // Optional: Clean up submissions after showing results
        // delete gameSubmissions[roomId];
      }
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);

      // Find and remove player from all rooms
      rooms.forEach((room, roomId) => {
        room.players.forEach((player, userId) => {
          if (player.socketId === socket.id) {
            room.players.delete(userId);
            console.log(
              `Removed disconnected user ${userId} from room ${roomId}`
            );

            // Clean up game submissions
            if (gameSubmissions[roomId]) {
              delete gameSubmissions[roomId][userId];
              if (Object.keys(gameSubmissions[roomId]).length === 0) {
                delete gameSubmissions[roomId];
              }
            }

            // Notify other players in the room about disconnection
            io.to(roomId).emit("playerLeft", { userId });

            // Broadcast updated room data to remaining users
            const playersData: Record<string, any> = {};
            room.players.forEach((player, userId) => {
              playersData[userId] = {
                socketId: player.socketId,
                userId: player.userId,
                health: player.health,
              };
            });

            io.to(roomId).emit("roomData", {
              roomId,
              players: playersData,
              playerCount: room.players.size,
            });

            // Clean up empty rooms
            if (room.players.size === 0) {
              rooms.delete(roomId);
              delete gameSubmissions[roomId]; // Clean up submissions too
              console.log(`Room ${roomId} deleted - no players remaining`);
            }
          }
        });
      });
    });
  });

  return io;
}