import "dotenv/config";

export const PORT = parseInt(process.env.PORT || "3001", 10);
export const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
