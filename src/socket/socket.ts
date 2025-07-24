import { Server } from "socket.io";
import http from "http";
import { prismaClient } from "../app/database";
import { Room, rooms } from "../type/room";

const gameSubmissions: Record<string, Record<string, any>> = {};

// Helper function to clean up stale socket connections in a room
function cleanStaleConnections(io: Server, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const connectedSockets = io.sockets.adapter.rooms.get(roomId);
  const connectedSocketIds = new Set(connectedSockets || []);
  
  // Remove players whose sockets are no longer connected
  const playersToRemove: string[] = [];
  room.players.forEach((player, userId) => {
    if (!connectedSocketIds.has(player.socketId)) {
      console.log(`Removing stale connection for user ${userId} with socket ${player.socketId}`);
      playersToRemove.push(userId);
    }
  });

  playersToRemove.forEach(userId => {
    room.players.delete(userId);
    // Clean up game submissions for removed players
    if (gameSubmissions[roomId]) {
      delete gameSubmissions[roomId][userId];
    }
  });

  // If room becomes empty, delete it
  if (room.players.size === 0) {
    rooms.delete(roomId);
    delete gameSubmissions[roomId];
    console.log(`Room ${roomId} deleted - no active players remaining`);
  }
}

// Helper function to get clean room data with only active connections
function getCleanRoomData(io: Server, roomId: string) {
  cleanStaleConnections(io, roomId);
  const room = rooms.get(roomId);
  if (!room) return null;

  const playersData: Record<string, any> = {};
  room.players.forEach((player, userId) => {
    playersData[userId] = {
      socketId: player.socketId,
      userId: player.userId,
      health: player.health,
    };
  });

  return {
    roomId,
    players: playersData,
    playerCount: room.players.size,
  };
}

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
      try {
        // First, clean any stale connections in the room
        cleanStaleConnections(io, roomId);
        
        let room = rooms.get(roomId);

        // If room not in memory, try to load from database
        if (!room) {
          const gameRoom = await prismaClient.gameRoom.findUnique({
            where: { code: roomId },
            include: {
              participants: true,
            },
          });

          if (!gameRoom) {
            socket.emit("error", "Room not found");
            return;
          }

          // Recreate room in memory from database
          room = {
            id: roomId,
            players: new Map(),
          };

          // Don't add participants back to memory automatically - let them rejoin
          rooms.set(roomId, room);
          console.log(`Room ${roomId} loaded from DB with ${gameRoom.participants.length} participants in database`);
        }

        // Check if user is already connected in this room
        if (room.players.has(userId)) {
          // User is reconnecting - update their socket ID
          const existingPlayer = room.players.get(userId)!;
          existingPlayer.socketId = socket.id;
          socket.join(roomId);
          console.log(`User ${userId} reconnected to room ${roomId} with new socket ${socket.id}`);
          socket.emit("joinedRoom", { roomId, userId, health: existingPlayer.health });
        } else {
          // New user joining
          if (room.players.size >= 2) {
            socket.emit("error", "Room is full");
            return;
          }

          // Add user to memory
          room.players.set(userId, { socketId: socket.id, userId, health: 3 });
          socket.join(roomId);
          console.log(`User ${userId} joined room ${roomId}`);
          socket.emit("joinedRoom", { roomId, userId, health: 3 });

          // Add to database if not already there
          const gameRoom = await prismaClient.gameRoom.findUnique({
            where: { code: roomId },
          });

          if (gameRoom) {
            const existingParticipant = await prismaClient.gameRoomParticipant.findFirst({
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
              console.log(`Added user ${userId} to database for room ${roomId}`);
            }
          }
        }

        // Broadcast updated room data to all connected players
        const roomData = getCleanRoomData(io, roomId);
        if (roomData) {
          io.to(roomId).emit("roomData", roomData);
          console.log(`Broadcasted clean room data to all users in room ${roomId}:`, roomData.players);
        }

      } catch (err) {
        console.error("Error during room join:", err);
        socket.emit("error", "Failed to join room");
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
      const roomData = getCleanRoomData(io, roomId);
      if (!roomData) {
        socket.emit("error", "Room not found");
        return;
      }

      console.log(`Sending clean room data for ${roomId}:`, roomData.players);
      socket.emit("roomData", roomData);
    });

    // Handle room rejoin
    socket.on("rejoinRoom", async ({ roomId, userId }) => {
      try {
        cleanStaleConnections(io, roomId);
        let room = rooms.get(roomId);

        // If room not in memory, try to load from database
        if (!room) {
          const gameRoom = await prismaClient.gameRoom.findUnique({
            where: { code: roomId },
            include: {
              participants: true,
            },
          });

          if (!gameRoom) {
            socket.emit("error", "Room not found");
            return;
          }

          // Check if user is a participant in the database
          const isParticipant = gameRoom.participants.some(p => p.user_id === userId);
          if (!isParticipant) {
            socket.emit("error", "User not part of room");
            return;
          }

          // Recreate room in memory
          room = {
            id: roomId,
            players: new Map(),
          };
          rooms.set(roomId, room);
          console.log(`Room ${roomId} recreated from DB for rejoin`);
        }

        // Add or update user in the room
        const existingPlayer = room.players.get(userId);
        if (existingPlayer) {
          // Update socket ID for existing player
          existingPlayer.socketId = socket.id;
        } else {
          // Add player back to memory (they were in DB but not in memory)
          room.players.set(userId, { socketId: socket.id, userId, health: 3 });
        }

        socket.join(roomId);
        socket.emit("roomRejoined", {
          roomId,
          userId,
          health: room.players.get(userId)?.health || 3,
        });

        console.log(`${userId} rejoined room ${roomId} with socket ${socket.id}`);

        // Broadcast updated room data
        const roomData = getCleanRoomData(io, roomId);
        if (roomData) {
          io.to(roomId).emit("roomData", roomData);
        }

      } catch (err) {
        console.error("Error during room rejoin:", err);
        socket.emit("error", "Failed to rejoin room");
      }
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

        // Broadcast updated clean room data to remaining users
        const roomData = getCleanRoomData(io, roomId);
        if (roomData) {
          io.to(roomId).emit("roomData", roomData);
        }
      }
    });

    socket.on("startGame", ({ roomId }) => {
      console.log(`Attempting to start game in room: ${roomId}`);
      
      // Validate room exists and has players
      cleanStaleConnections(io, roomId);
      const room = rooms.get(roomId);
      
      if (!room) {
        console.error(`Cannot start game - room ${roomId} not found`);
        socket.emit("error", "Room not found");
        return;
      }
      
      console.log(`Room ${roomId} has ${room.players.size} players:`, Array.from(room.players.keys()));
      
      if (room.players.size < 2) {
        console.error(`Cannot start game - room ${roomId} only has ${room.players.size} players`);
        socket.emit("error", "Need 2 players to start game");
        return;
      }
      
      // Reset game submissions when starting new game
      if (gameSubmissions[roomId]) {
        delete gameSubmissions[roomId];
      }
      
      console.log(`Broadcasting gameStarted to room ${roomId}`);
      io.to(roomId).emit("gameStarted", { roomId }); // broadcast ke semua dalam room
      console.log(`Game started successfully in room: ${roomId}`);
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
      
      // Store the submission with timestamp
      gameSubmissions[roomId][userId] = {
        ...province,
        submittedAt: new Date().toISOString()
      };
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
        // First, notify that both players have submitted
        console.log(`Both players submitted in room ${roomId}, notifying all players`);
        io.to(roomId).emit("bothPlayersSubmitted", {
          message: "Both players have submitted their answers!",
          submissionCount: submittedCount,
          totalPlayers: totalPlayers
        });
        
        // Then after a brief moment, send the detailed results
        setTimeout(() => {
          const results = Object.entries(gameSubmissions[roomId]).map(([uid, prov]) => ({
            userId: uid,
            province: prov
          }));
          
          console.log(`Sending detailed results for room ${roomId}:`, results);
          io.to(roomId).emit("showResults", { results });
        }, 1500); // 1.5 second delay to let users process the "both submitted" message
        
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

            // Broadcast updated clean room data to remaining users
            const roomData = getCleanRoomData(io, roomId);
            if (roomData) {
              io.to(roomId).emit("roomData", roomData);
            }
          }
        });
      });
    });
  });

  return io;
}