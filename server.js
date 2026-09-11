require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");
const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString("hex");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "rupayan_admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeThisAdminPassword123!";
const ROOM_NAME = process.env.ROOM_NAME || "Friends Room";
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 1000, pingTimeout: 5000 });
const dataDir = path.join(__dirname, "data");
require("fs").mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "synctune.db"));
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, username TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL);`);
try { db.prepare("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0").run(); } catch {}
const admin = db.prepare("SELECT id FROM users WHERE username = ?").get(ADMIN_USERNAME);
if (!admin) db.prepare("INSERT INTO users (username,password_hash,is_admin) VALUES (?,?,1)").run(ADMIN_USERNAME, bcrypt.hashSync(ADMIN_PASSWORD, 12));
else db.prepare("UPDATE users SET is_admin=1 WHERE username=?").run(ADMIN_USERNAME);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
let roomState = { videoId: "", playing: false, position: 0, updatedAt: Date.now(), changedBy: "System" };
let queue = [];
const getChatHistory = db.prepare("SELECT id, username, message, created_at AS createdAt FROM chat_messages ORDER BY created_at ASC LIMIT 200");
const saveChatMessage = db.prepare("INSERT INTO chat_messages (id, username, message, created_at) VALUES (?, ?, ?, ?)");
function signUser(user) { return jwt.sign({ id: user.id, username: user.username, isAdmin: Boolean(user.is_admin) }, JWT_SECRET, { expiresIn: "7d" }); }
function getUserFromToken(token) { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } }
function authFromRequest(req) { const header = req.headers.authorization || ""; const token = header.startsWith("Bearer ") ? header.slice(7) : req.cookies.synctune_token; return token ? getUserFromToken(token) : null; }
function requireAdmin(req,res,next) { const user=authFromRequest(req); if(!user || !user.isAdmin) return res.status(403).json({error:"Admin access required"}); req.user=user; next(); }
function extractYouTubeId(input) { try { const url=new URL(input.trim()); if(url.hostname==="youtu.be") return url.pathname.slice(1).split("/")[0]; if(url.hostname.includes("youtube.com")){ if(url.pathname==="/watch") return url.searchParams.get("v"); if(url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2]; if(url.pathname.startsWith("/embed/")) return url.pathname.split("/")[2]; } } catch {} return null; }
function currentPosition() { return roomState.playing ? roomState.position + (Date.now()-roomState.updatedAt)/1000 : roomState.position; }
function publicState() { return { roomName:ROOM_NAME, videoId:roomState.videoId, playing:roomState.playing, position:Math.max(0,currentPosition()), changedBy:roomState.changedBy, serverTime:Date.now(), queue }; }
function emitState() { io.to("main").emit("state",publicState()); }
function startNext() { const next=queue.shift(); if(!next){ roomState={videoId:"",playing:false,position:0,updatedAt:Date.now(),changedBy:"System"}; emitState(); return; } roomState={videoId:next.videoId,playing:true,position:0,updatedAt:Date.now(),changedBy:next.addedBy}; emitState(); }
app.get("/api/config",(req,res)=>res.json({roomName:ROOM_NAME}));
app.post("/api/login",(req,res)=>{ const username=String(req.body.username||"").trim(); const password=String(req.body.password||""); const user=db.prepare("SELECT * FROM users WHERE username=?").get(username); if(!user||!bcrypt.compareSync(password,user.password_hash)) return res.status(401).json({error:"Invalid username or password"}); res.json({token:signUser(user),username:user.username,isAdmin:Boolean(user.is_admin)}); });
app.post("/api/admin/users",requireAdmin,(req,res)=>{ const username=String(req.body.username||"").trim(); const password=String(req.body.password||""); if(!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) return res.status(400).json({error:"Username must be 3-30 characters and use letters, numbers, _, ., or -"}); if(password.length<6) return res.status(400).json({error:"Password must be at least 6 characters"}); try { db.prepare("INSERT INTO users (username,password_hash,is_admin) VALUES (?,?,0)").run(username,bcrypt.hashSync(password,12)); res.json({message:`User ${username} created`}); } catch { res.status(409).json({error:"Username already exists"}); } });
app.get("/api/admin/users",requireAdmin,(req,res)=>{ const users=db.prepare("SELECT id,username,is_admin,created_at FROM users ORDER BY id ASC").all(); res.json({users}); });
app.delete("/api/admin/users/:id",requireAdmin,(req,res)=>{ const id=Number(req.params.id); const user=db.prepare("SELECT id,username,is_admin FROM users WHERE id=?").get(id); if(!user)return res.status(404).json({error:"User not found"}); if(user.is_admin)return res.status(400).json({error:"Admin account cannot be deleted"}); db.prepare("DELETE FROM users WHERE id=?").run(id); res.json({message:`User ${user.username} deleted`}); });
app.put("/api/admin/users/:id/password",requireAdmin,(req,res)=>{ const id=Number(req.params.id); const password=String(req.body.password||""); if(password.length<6)return res.status(400).json({error:"Password must be at least 6 characters"}); const user=db.prepare("SELECT username FROM users WHERE id=?").get(id); if(!user)return res.status(404).json({error:"User not found"}); db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(password,12),id); res.json({message:`Password updated for ${user.username}`}); });
app.get("/api/me",(req,res)=>{ const user=authFromRequest(req); if(!user)return res.status(401).json({error:"Not logged in"}); res.json({username:user.username,isAdmin:Boolean(user.isAdmin)}); });
app.get("/api/state",(req,res)=>{if(!authFromRequest(req))return res.status(401).json({error:"Not logged in"});res.json(publicState());});
io.use((socket,next)=>{const user=getUserFromToken(socket.handshake.auth?.token);if(!user)return next(new Error("Unauthorized"));socket.user=user;next();});
io.on("connection",socket=>{socket.join("main");socket.emit("state",publicState());socket.emit("chatHistory",getChatHistory.all());io.to("main").emit("presence",{count:io.sockets.adapter.rooms.get("main")?.size||0});
 socket.on("setSong",input=>{const id=extractYouTubeId(String(input||""));if(!id)return socket.emit("errorMessage","Please enter a valid YouTube URL.");roomState={videoId:id,playing:true,position:0,updatedAt:Date.now(),changedBy:socket.user.username};emitState();});
 socket.on("addToQueue",input=>{const id=extractYouTubeId(String(input||""));if(!id)return socket.emit("errorMessage","Please enter a valid YouTube URL.");queue.push({videoId:id,addedBy:socket.user.username,id:crypto.randomUUID()});emitState();});
 socket.on("removeFromQueue",id=>{queue=queue.filter(item=>item.id!==id);emitState();});
 socket.on("play",position=>{if(!roomState.videoId)return;roomState.position=Math.max(0,Number(position)||0);roomState.playing=true;roomState.updatedAt=Date.now();roomState.changedBy=socket.user.username;emitState();});
 socket.on("pause",position=>{if(!roomState.videoId)return;roomState.position=Math.max(0,Number(position)||0);roomState.playing=false;roomState.updatedAt=Date.now();roomState.changedBy=socket.user.username;emitState();});
 socket.on("seek",position=>{if(!roomState.videoId)return;roomState.position=Math.max(0,Number(position)||0);roomState.updatedAt=Date.now();roomState.changedBy=socket.user.username;emitState();});
 socket.on("next",()=>startNext());
 socket.on("ended",()=>{if(roomState.videoId)startNext();});
 socket.on("sendMessage",(input,ack)=>{const message=String(input||"").trim().slice(0,500);if(!message){ack?.({ok:false,error:"Write a message before sending."});return;}const chatMessage={id:crypto.randomUUID(),username:socket.user.username,message,createdAt:Date.now()};try{saveChatMessage.run(chatMessage.id,chatMessage.username,chatMessage.message,chatMessage.createdAt);io.to("main").emit("chatMessage",chatMessage);ack?.({ok:true});}catch(error){console.error("Unable to save chat message",error);ack?.({ok:false,error:"Your message could not be saved. Please try again."});}});
 socket.on("requestSync",()=>socket.emit("state",publicState()));
 socket.on("disconnect",()=>io.to("main").emit("presence",{count:io.sockets.adapter.rooms.get("main")?.size||0}));
});
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,"0.0.0.0",()=>console.log(`SyncTune running on port ${PORT}`));
