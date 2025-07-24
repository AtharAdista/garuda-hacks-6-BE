export type PlayerData = {
    socketId: string;
    userId: string;
    health: number;
}

export type RoomData = {
    roomId: string;
    players: Map<string, PlayerData>;
}
