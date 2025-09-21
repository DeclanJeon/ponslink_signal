# QuickMeet Signaling Server

This is the signaling server for the QuickMeet application, built with Express.js and Socket.IO.

## Features

- Room management for WebRTC connections
- User presence tracking
- Message forwarding for WebRTC signaling (offer, answer, ICE candidates)
- Chat messaging between users

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Start the server:
   ```bash
   pnpm start
   ```

   The server will run on port 5500 by default.

## API Endpoints

- `GET /` - Health check endpoint

## Socket.IO Events

### Client to Server

- `join-room` - Join a room with user information
  ```json
  {
    "roomId": "string",
    "userId": "string",
    "nickname": "string"
  }
  ```

- `leave-room` - Leave a room
  ```json
  "roomId"
  ```

- `message` - Send a message to a room
  ```json
  {
    "type": "offer|answer|ice-candidate|chat|file",
    "roomId": "string",
    "userId": "string",
    "data": "any"
  }
  ```

### Server to Client

- `user-joined` - Notifies when a user joins the room
- `user-left` - Notifies when a user leaves the room
- `message` - Forwards messages between users
- `connect` - Socket.IO connection established
- `disconnect` - Socket.IO connection lost

## Environment Variables

- `PORT` - Port to run the server on (default: 5500)

## Integration with QuickMeet

The QuickMeet client expects the signaling server to be available at `ws://localhost:5500`. This can be configured using the `NEXT_PUBLIC_SIGNALING_SERVER` environment variable in the client's `.env.local` file.

## Package Manager
This project uses `pnpm` as its package manager. Please ensure you have `pnpm` installed.
If you were previously using `npm` or `yarn`, please remove their lockfiles (`package-lock.json`, `yarn.lock`) and `node_modules` directory, then reinstall dependencies with `pnpm`:

```bash
rm -rf node_modules package-lock.json yarn.lock
pnpm install
```