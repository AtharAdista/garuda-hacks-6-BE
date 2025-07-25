import { Server } from "socket.io";
import http from "http";
import { prismaClient, ensureDatabaseConnection } from "../app/database";
import { Room, rooms } from "../type/room";
import { CulturalService } from "../service/cultural-service";

const gameSubmissions: Record<string, Record<string, any>> = {};

// Ready state management per room
const roomReadyState: Record<string, Set<string>> = {};

// Track which rooms have cultural data started to prevent duplicates
const roomCulturalStarted: Record<string, boolean> = {};

// Cultural data state management per room
interface CulturalDisplayState {
  currentIndex: number;
  displayState:
    | "initial_loading"
    | "displaying"
    | "inter_loading"
    | "completed"
    | "error";
  timeRemaining: number;
  totalItems: number;
  items: any[];
  timer?: NodeJS.Timeout;
}

const roomCulturalState: Record<string, CulturalDisplayState> = {};

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
      console.log(
        `Removing stale connection for user ${userId} with socket ${player.socketId}`
      );
      playersToRemove.push(userId);
    }
  });

  playersToRemove.forEach((userId) => {
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
    cleanupCulturalState(roomId);
    cleanupReadyState(roomId);
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

// Cultural data helper functions
function initializeCulturalState(roomId: string) {
  roomCulturalState[roomId] = {
    currentIndex: -1,
    displayState: "initial_loading",
    timeRemaining: 10,
    totalItems: 0,
    items: [],
  };
}

function cleanupCulturalState(roomId: string) {
  const state = roomCulturalState[roomId];
  if (state?.timer) {
    clearInterval(state.timer);
  }
  delete roomCulturalState[roomId];
}

function cleanupReadyState(roomId: string) {
  delete roomReadyState[roomId];
  delete roomCulturalStarted[roomId];
}

function broadcastCulturalState(io: Server, roomId: string) {
  const state = roomCulturalState[roomId];
  if (state) {
    const culturalData = {
      currentIndex: state.currentIndex,
      displayState: state.displayState,
      timeRemaining: state.timeRemaining,
      totalItems: state.totalItems,
      currentItem:
        state.currentIndex >= 0 ? state.items[state.currentIndex] : null,
    };

    // Check how many sockets are in the room
    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
    const socketCount = socketsInRoom ? socketsInRoom.size : 0;

    console.log(
      `Broadcasting cultural state to room ${roomId} (${socketCount} sockets):`,
      culturalData
    );
    console.log(`Sockets in room ${roomId}:`, Array.from(socketsInRoom || []));

    io.to(roomId).emit("culturalDataStateUpdate", culturalData);
  }
}

async function startCulturalDataFlow(io: Server, roomId: string) {
  console.log(`Starting cultural data flow for room ${roomId}`);

  // Check if cultural data has already been started for this room
  if (roomCulturalStarted[roomId]) {
    console.log(`Cultural data already started for room ${roomId}, skipping`);
    return;
  }

  // Check if room exists and has players
  const room = rooms.get(roomId);
  if (!room) {
    console.error(`Cannot start cultural data flow - room ${roomId} not found`);
    return;
  }

  console.log(
    `Room ${roomId} has ${room.players.size} players before starting cultural flow`
  );

  // Mark cultural data as started for this room
  roomCulturalStarted[roomId] = true;

  initializeCulturalState(roomId);

  // Add a small delay to ensure all players are connected and ready
  setTimeout(() => {
    console.log(`Broadcasting initial cultural state to room ${roomId}`);
    broadcastCulturalState(io, roomId);

    // Start fetching cultural data in background
    fetchCulturalDataForRoom(roomId);

    // Start the timer
    const state = roomCulturalState[roomId];
    if (state) {
      console.log(`Starting cultural timer for room ${roomId}`);
      state.timer = setInterval(() => {
        updateCulturalTimer(io, roomId);
      }, 1000);
    }
  }, 1000); // 1 second delay to ensure socket connections are stable
}

async function fetchCulturalDataForRoom(roomId: string) {
  const maxItems = 10;

  for (let i = 1; i <= maxItems; i++) {
    try {
      const result = await CulturalService.fetchCulturalMedia(i);
      const state = roomCulturalState[roomId];
      if (state) {
        const culturalItem = {
          province: result.province,
          media_type: result.media_type,
          media_url: result.media_url,
          cultural_category: result.cultural_category,
          query: result.query,
          cultural_context: result.cultural_fun_fact || result.query,
        };
        state.items.push(culturalItem);
        state.totalItems = state.items.length;
        console.log(
          `Fetched cultural item ${i} for room ${roomId}: ${result.province}`
        );
      }
    } catch (error) {
      console.error(
        `Error fetching cultural item ${i} for room ${roomId}:`,
        error
      );
    }
  }
}

function updateCulturalTimer(io: Server, roomId: string) {
  const state = roomCulturalState[roomId];
  if (!state) return;

  state.timeRemaining--;

  if (state.displayState === "initial_loading") {
    if (state.timeRemaining <= 0) {
      if (state.items.length > 0) {
        // Start displaying first item
        state.currentIndex = 0;
        state.displayState = "displaying";
        state.timeRemaining = 30;
        console.log(`Room ${roomId}: Starting to display cultural items`);
      } else {
        // Reset loading timer if no data yet
        state.timeRemaining = 10;
      }
    }
  } else if (state.displayState === "displaying") {
    if (state.timeRemaining <= 0) {
      if (state.currentIndex + 1 < state.items.length) {
        // Move to inter-loading
        state.displayState = "inter_loading";
        state.timeRemaining = 15;
        console.log(`Room ${roomId}: Moving to inter-loading`);
      } else {
        // All items displayed
        state.displayState = "completed";
        state.timeRemaining = 0;
        if (state.timer) {
          clearInterval(state.timer);
          delete state.timer;
        }
        console.log(`Room ${roomId}: Cultural display completed`);
      }
    }
  } else if (state.displayState === "inter_loading") {
    if (state.timeRemaining <= 0) {
      // Move to next item
      state.currentIndex++;
      state.displayState = "displaying";
      state.timeRemaining = 30;
      console.log(`Room ${roomId}: Displaying item ${state.currentIndex + 1}`);
    }
  }

  broadcastCulturalState(io, roomId);
}

export function initializeSocket(server: http.Server) {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("createRoom", async ({ roomId, userId }) => {
      try {
        // Ensure database connection is healthy
        const connectionHealthy = await ensureDatabaseConnection();
        if (!connectionHealthy) {
          console.error("Database connection failed for createRoom");
          socket.emit("error", { message: "Database connection issue, please try again" });
          return;
        }

        // Check if room already exists in database first
        const existingRoom = await prismaClient.gameRoom.findUnique({
          where: { code: roomId },
          include: { participants: true },
        });

        let gameRoom;
        if (existingRoom) {
          // Room exists, check if user is already a participant
          const existingParticipant = existingRoom.participants.find(
            (p) => p.user_id === userId
          );
          
          if (!existingParticipant) {
            // Add user as participant if not already there
            await prismaClient.gameRoomParticipant.create({
              data: {
                game_room_id: existingRoom.id,
                user_id: userId,
              },
            });
          }
          gameRoom = existingRoom;
        } else {
          // Create new room and add participant in a transaction to avoid race conditions
          gameRoom = await prismaClient.$transaction(async (tx) => {
            const newRoom = await tx.gameRoom.create({
              data: {
                code: roomId,
                mode: "player_vs_player",
                status: "waiting",
              },
            });

            await tx.gameRoomParticipant.create({
              data: {
                game_room_id: newRoom.id,
                user_id: userId,
              },
            });

            return newRoom;
          });
        }

        const room: Room = {
          id: roomId,
          players: new Map([
            [userId, { socketId: socket.id, userId, health: 3 }],
          ]),
        };
        rooms.set(roomId, room);

        socket.join(roomId);
        console.log(`Room ${roomId} created/joined by ${userId}`);
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
        // Handle specific Prisma errors
        if (error && typeof error === 'object' && 'code' in error) {
          if (error.code === "P2002") {
            socket.emit("error", { message: "Room already exists" });
          } else if (error.code === "42P05") {
            socket.emit("error", { message: "Database connection issue, please try again" });
          } else {
            socket.emit("error", { message: "Failed to create room" });
          }
        } else {
          socket.emit("error", { message: "Failed to create room" });
        }
      }
    });

    // Handle room joining
    socket.on("joinRoom", async ({ roomId, userId }) => {
      try {
        // Ensure database connection is healthy
        const connectionHealthy = await ensureDatabaseConnection();
        if (!connectionHealthy) {
          console.error("Database connection failed for joinRoom");
          socket.emit("error", "Database connection issue, please try again");
          return;
        }

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
          console.log(
            `Room ${roomId} loaded from DB with ${gameRoom.participants.length} participants in database`
          );
        }

        // Check if user is already connected in this room
        if (room.players.has(userId)) {
          // User is reconnecting - update their socket ID
          const existingPlayer = room.players.get(userId)!;
          existingPlayer.socketId = socket.id;
          socket.join(roomId);
          console.log(
            `User ${userId} reconnected to room ${roomId} with new socket ${socket.id}`
          );
          socket.emit("joinedRoom", {
            roomId,
            userId,
            health: existingPlayer.health,
          });
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
            // Use upsert to handle race conditions
            try {
              await prismaClient.gameRoomParticipant.upsert({
                where: {
                  game_room_id_user_id: {
                    game_room_id: gameRoom.id,
                    user_id: userId,
                  },
                },
                update: {}, // No update needed if exists
                create: {
                  game_room_id: gameRoom.id,
                  user_id: userId,
                },
              });
              console.log(
                `Added/confirmed user ${userId} in database for room ${roomId}`
              );
            } catch (participantError) {
              console.warn(`Non-critical participant creation error for ${userId}:`, participantError);
              // Continue execution - this is not critical for the game flow
            }
          }
        }

        // Broadcast updated room data to all connected players
        const roomData = getCleanRoomData(io, roomId);
        if (roomData) {
          io.to(roomId).emit("roomData", roomData);
          console.log(
            `Broadcasted clean room data to all users in room ${roomId}:`,
            roomData.players
          );
        }
      } catch (err) {
        console.error("Error during room join:", err);
        socket.emit("error", "Failed to join room");
      }
    });

    // PINDAHKAN KELUAR DARI requestRoomData - Handler province selection (for real-time preview)
    socket.on("selectProvince", ({ roomId, province, userId }) => {
      console.log(
        `User ${userId} selecting province: ${province.name} in room ${roomId}`
      );
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
        // Ensure database connection is healthy
        const connectionHealthy = await ensureDatabaseConnection();
        if (!connectionHealthy) {
          console.error("Database connection failed for rejoinRoom");
          socket.emit("error", "Database connection issue, please try again");
          return;
        }

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
          const isParticipant = gameRoom.participants.some(
            (p) => p.user_id === userId
          );
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

        console.log(
          `${userId} rejoined room ${roomId} with socket ${socket.id}`
        );

        // Broadcast updated room data
        const roomData = getCleanRoomData(io, roomId);
        if (roomData) {
          io.to(roomId).emit("roomData", roomData);
        }
        // Send current cultural state if it exists
        if (roomCulturalState[roomId]) {
          broadcastCulturalState(io, roomId);
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

        // If room becomes empty after someone leaves, clean up states
        if (room.players.size === 0) {
          cleanupCulturalState(roomId);
          cleanupReadyState(roomId);
        } else {
          // Remove user from ready state and broadcast update
          if (roomReadyState[roomId]) {
            roomReadyState[roomId].delete(userId);
            io.to(roomId).emit("readyStateUpdate", {
              readyPlayers: Array.from(roomReadyState[roomId]),
              totalPlayers: room.players.size,
            });
          }
        }
      }
    });

    // Handle player ready state
    socket.on("playerReady", ({ roomId, userId }) => {
      console.log(`Player ${userId} is ready in room ${roomId}`);

      const room = rooms.get(roomId);
      if (!room) {
        console.error(`Cannot mark ready - room ${roomId} not found`);
        socket.emit("error", "Room not found");
        return;
      }

      // Initialize ready state for room if not exists
      if (!roomReadyState[roomId]) {
        roomReadyState[roomId] = new Set();
      }

      // Add user to ready set
      roomReadyState[roomId].add(userId);

      console.log(
        `Room ${roomId} ready players:`,
        Array.from(roomReadyState[roomId])
      );

      // Broadcast ready state to all players in room
      io.to(roomId).emit("readyStateUpdate", {
        readyPlayers: Array.from(roomReadyState[roomId]),
        totalPlayers: room.players.size,
      });

      // Check if both players are ready
      if (
        roomReadyState[roomId].size === room.players.size &&
        room.players.size >= 2
      ) {
        console.log(
          `All players ready in room ${roomId}, starting game and cultural data`
        );

        // Reset game submissions when starting new game
        if (gameSubmissions[roomId]) {
          delete gameSubmissions[roomId];
        }

        // Broadcast game started
        io.to(roomId).emit("gameStarted", { roomId });

        // Start cultural data flow immediately
        setTimeout(() => {
          startCulturalDataFlow(io, roomId);
        }, 500); // Small delay to ensure all clients receive gameStarted first

        console.log(`Game and cultural data started for room: ${roomId}`);
      }
    });

    // Handle player unready state
    socket.on("playerUnready", ({ roomId, userId }) => {
      console.log(`Player ${userId} is no longer ready in room ${roomId}`);

      if (roomReadyState[roomId]) {
        roomReadyState[roomId].delete(userId);

        const room = rooms.get(roomId);
        if (room) {
          // Broadcast updated ready state
          io.to(roomId).emit("readyStateUpdate", {
            readyPlayers: Array.from(roomReadyState[roomId]),
            totalPlayers: room.players.size,
          });
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

      console.log(
        `Room ${roomId} has ${room.players.size} players:`,
        Array.from(room.players.keys())
      );

      if (room.players.size < 2) {
        console.error(
          `Cannot start game - room ${roomId} only has ${room.players.size} players`
        );
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

    // Handle request for current cultural state
    socket.on("requestCulturalState", ({ roomId }) => {
      console.log(
        `User ${socket.id} requesting cultural state for room ${roomId}`
      );

      // Verify socket is in the room
      const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
      const isInRoom = socketsInRoom?.has(socket.id);

      if (!isInRoom) {
        console.log(
          `Socket ${socket.id} is not in room ${roomId}, cannot send cultural state`
        );
        socket.emit("error", { message: "Not in room" });
        return;
      }

      console.log(`Socket ${socket.id} verified in room ${roomId}`);

      const state = roomCulturalState[roomId];
      if (state) {
        const culturalData = {
          currentIndex: state.currentIndex,
          displayState: state.displayState,
          timeRemaining: state.timeRemaining,
          totalItems: state.totalItems,
          currentItem:
            state.currentIndex >= 0 ? state.items[state.currentIndex] : null,
        };
        console.log(`Sending cultural state to ${socket.id}:`, culturalData);
        socket.emit("culturalDataStateUpdate", culturalData);
      } else {
        console.log(
          `No cultural state found for room ${roomId}, sending default state`
        );
        socket.emit("culturalDataStateUpdate", {
          currentIndex: -1,
          displayState: "initial_loading",
          timeRemaining: 0,
          totalItems: 0,
          currentItem: null,
        });
      }
    });

    // PERBAIKAN UTAMA - Handle province submission (final answer)
    socket.on("submitProvince", ({ province, userId, roomId }) => {
      console.log(
        `User ${userId} submitted province:`,
        province.name,
        "in room:",
        roomId
      );

      // Get room info first to validate
      const room = rooms.get(roomId);
      if (!room) {
        console.error(`Room ${roomId} not found when user ${userId} submitted`);
        socket.emit("error", "Room not found");
        return;
      }

      // Check if submissions are allowed (only during display phase)
      const culturalState = roomCulturalState[roomId];
      if (!culturalState || culturalState.displayState !== "displaying") {
        console.log(`Submission rejected for ${userId} - not in display phase. Current state: ${culturalState?.displayState}`);
        socket.emit("error", "Submissions not allowed at this time");
        return;
      }

      // Initialize room submissions if not exists
      if (!gameSubmissions[roomId]) {
        gameSubmissions[roomId] = {};
      }

      // Store the submission with timestamp
      gameSubmissions[roomId][userId] = {
        ...province,
        submittedAt: new Date().toISOString(),
      };
      console.log(`Stored submission for user ${userId}:`, province.name);
      console.log(
        `Current submissions in room ${roomId}:`,
        Object.keys(gameSubmissions[roomId])
      );

      // Broadcast ke opponent bahwa user ini sudah submit (dengan jawabannya)
      socket.to(roomId).emit("opponentSubmitted", {
        userId,
        province,
      });
      console.log(`Broadcasted opponentSubmitted to room ${roomId}`);

      const totalPlayers = room.players.size;
      const submittedCount = Object.keys(gameSubmissions[roomId]).length;

      console.log(
        `Room ${roomId}: ${submittedCount}/${totalPlayers} players submitted`
      );

      // Cek apakah semua player dalam room sudah submit
      if (submittedCount === totalPlayers) {
        // First, notify that both players have submitted
        console.log(
          `Both players submitted in room ${roomId}, notifying all players`
        );
        io.to(roomId).emit("bothPlayersSubmitted", {
          message: "Both players have submitted their answers!",
          submissionCount: submittedCount,
          totalPlayers: totalPlayers,
        });

        // Skip remaining display time and move to inter-loading immediately
        const culturalState = roomCulturalState[roomId];
        if (culturalState && culturalState.displayState === "displaying") {
          culturalState.displayState = "inter_loading";
          culturalState.timeRemaining = 15;
          console.log(`Room ${roomId}: Skipping to inter-loading phase as both players submitted`);
          broadcastCulturalState(io, roomId);
        }

        // Then after a brief moment, send the detailed results
        setTimeout(() => {
          // Get the current cultural item to determine correct answer
          const culturalState = roomCulturalState[roomId];
          const correctProvince = culturalState?.items[culturalState.currentIndex]?.province || "Banten";
          
          const results = Object.entries(gameSubmissions[roomId]).map(
            ([uid, prov]) => {
              const player = room.players.get(uid);
              return {
                userId: uid,
                province: prov,
                isCorrect: prov.name === correctProvince,
                health: player?.health ?? 0,
              };
            }
          );

          const playerIds = Array.from(room.players.keys());
          const [p1, p2] = playerIds;
          const r1 = results.find((r) => r.userId === p1);
          const r2 = results.find((r) => r.userId === p2);

          if (r1 && r2) {
            const p1Player = room.players.get(p1);
            const p2Player = room.players.get(p2);

            if (r1.isCorrect && r2.isCorrect) {
              console.log("Both players answered correctly, no damage taken.");
            } else if (!r1.isCorrect && !r2.isCorrect) {
              console.log(
                "Both players answered incorrectly, both lose 1 health."
              );
              if (p1Player) p1Player.health -= 1;
              if (p2Player) p2Player.health -= 1;
            } else if (r1.isCorrect && !r2.isCorrect) {
              console.log("P1 benar, P2 salah — P2 kehilangan darah.");
              if (p2Player) p2Player.health -= 1;
            } else if (!r1.isCorrect && r2.isCorrect) {
              console.log("P1 salah, P2 benar — P1 kehilangan darah.");
              if (p1Player) p1Player.health -= 1;
            }

            // Update hasil akhir setelah damage
            r1.health = p1Player?.health ?? r1.health;
            r2.health = p2Player?.health ?? r2.health;

            console.log(
              `Sending detailed results for room ${roomId}:`,
              results
            );
            io.to(roomId).emit("showResults", {
              results,
              correctAnswer: correctProvince,
              culturalData: culturalState?.items[culturalState.currentIndex] || null,
            });

            // Cek apakah salah satu pemain mati
            const isGameOver =
              (p1Player?.health ?? 0) <= 0 || (p2Player?.health ?? 0) <= 0;

            if (!isGameOver) {
              // Kirim event untuk lanjut ke ronde berikutnya
              setTimeout(() => {
                io.to(roomId).emit("nextRound", {
                  roundMessage: "Next round is starting!",
                  players: [
                    { userId: p1, health: p1Player?.health ?? 0 },
                    { userId: p2, health: p2Player?.health ?? 0 },
                  ],
                });

                // Kosongkan submission untuk ronde baru
                gameSubmissions[roomId] = {};
              }, 2000); // delay sebelum next round
            } else {
              // Kirim event game over
              const winner =
                (p1Player?.health ?? 0) > 0
                  ? p1
                  : (p2Player?.health ?? 0) > 0
                  ? p2
                  : null;

              io.to(roomId).emit("gameOver", {
                winner,
                players: [
                  { userId: p1, health: p1Player?.health ?? 0 },
                  { userId: p2, health: p2Player?.health ?? 0 },
                ],
              });

              // Optional: bersihkan submissions
              delete gameSubmissions[roomId];
            }
          }
        }, 1500); // 1.5 second delay to let users process the "both submitted" message

        // Optional: Clean up submissions after showing results
        // delete gameSubmissions[roomId];
      }
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      console.log("Client disconnected:", socket.id, "Reason:", reason);

      // Find and remove player from all rooms
      const roomsToCleanup: string[] = [];
      
      rooms.forEach((room, roomId) => {
        room.players.forEach((player, userId) => {
          if (player.socketId === socket.id) {
            room.players.delete(userId);
            console.log(
              `Removed disconnected user ${userId} from room ${roomId} (reason: ${reason})`
            );

            // Clean up game submissions
            if (gameSubmissions[roomId]) {
              delete gameSubmissions[roomId][userId];
              if (Object.keys(gameSubmissions[roomId]).length === 0) {
                delete gameSubmissions[roomId];
              }
            }

            // Only notify others if it's an unexpected disconnect (not intentional leave)
            if (reason !== "client namespace disconnect") {
              io.to(roomId).emit("playerLeft", { userId, reason: "disconnected" });
            }

            // Broadcast updated clean room data to remaining users
            const roomData = getCleanRoomData(io, roomId);
            if (roomData) {
              io.to(roomId).emit("roomData", roomData);
            }

            // If room becomes empty after disconnect, clean up states
            if (room.players.size === 0) {
              roomsToCleanup.push(roomId);
            } else {
              // Remove user from ready state and broadcast update
              if (roomReadyState[roomId]) {
                roomReadyState[roomId].delete(userId);
                io.to(roomId).emit("readyStateUpdate", {
                  readyPlayers: Array.from(roomReadyState[roomId]),
                  totalPlayers: room.players.size,
                });
              }
            }
          }
        });
      });

      // Clean up empty rooms
      roomsToCleanup.forEach(roomId => {
        cleanupCulturalState(roomId);
        cleanupReadyState(roomId);
        rooms.delete(roomId);
        console.log(`Cleaned up empty room: ${roomId}`);
      });
    });
  });

  return io;
}
