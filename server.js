const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Хранилище лобби
const lobbies = new Map();

// Генерация случайного кода лобби
function generateLobbyCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Проверка валидности расстановки кораблей
function validateShipPlacement(ships) {
  const grid = Array(10).fill(null).map(() => Array(10).fill(0));
  const shipSizes = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
  
  if (ships.length !== 10) return false;
  
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i];
    if (ship.length !== shipSizes[i]) return false;
    
    // Проверка, что корабль прямой (горизонтальный или вертикальный)
    const isHorizontal = ship[0].row === ship[ship.length - 1].row;
    const isVertical = ship[0].col === ship[ship.length - 1].col;
    
    if (!isHorizontal && !isVertical) return false;
    
    // Проверка, что все клетки корабля последовательны
    for (let j = 0; j < ship.length; j++) {
      const cell = ship[j];
      if (cell.row < 0 || cell.row >= 10 || cell.col < 0 || cell.col >= 10) return false;
      
      if (isHorizontal) {
        if (cell.row !== ship[0].row || cell.col !== ship[0].col + j) return false;
      } else {
        if (cell.col !== ship[0].col || cell.row !== ship[0].row + j) return false;
      }
      
      // Проверка на пересечение с другими кораблями
      if (grid[cell.row][cell.col] === 1) return false;
      
      // Отметка клетки и соседних клеток
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = cell.row + dr;
          const nc = cell.col + dc;
          if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10) {
            grid[nr][nc] = 1;
          }
        }
      }
    }
  }
  
  return true;
}

// Проверка попадания
function checkHit(ships, row, col) {
  for (const ship of ships) {
    for (const cell of ship) {
      if (cell.row === row && cell.col === col) {
        return { hit: true, ship: ship };
      }
    }
  }
  return { hit: false };
}

// Проверка, потоплен ли корабль
function isShipSunk(ship, hits) {
  return ship.every(cell => 
    hits.some(hit => hit.row === cell.row && hit.col === cell.col)
  );
}

// Проверка победы
function checkWin(ships, hits) {
  return ships.every(ship => isShipSunk(ship, hits));
}

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  // Создание лобби
  socket.on('createLobby', () => {
    const lobbyCode = generateLobbyCode();
    const lobby = {
      code: lobbyCode,
      host: socket.id,
      players: [socket.id],
      gameState: 'waiting', // waiting, placing, playing, finished
      boards: {},
      shots: {},
      currentTurn: null
    };
    
    lobbies.set(lobbyCode, lobby);
    socket.join(lobbyCode);
    socket.emit('lobbyCreated', { code: lobbyCode });
    console.log(`Лобби создано: ${lobbyCode}`);
  });

  // Присоединение к лобби
  socket.on('joinLobby', (data) => {
    const { code } = data;
    const lobby = lobbies.get(code);
    
    if (!lobby) {
      socket.emit('lobbyError', { message: 'Лобби не найдено' });
      return;
    }
    
    if (lobby.players.length >= 2) {
      socket.emit('lobbyError', { message: 'Лобби заполнено' });
      return;
    }
    
    lobby.players.push(socket.id);
    socket.join(code);
    socket.emit('lobbyJoined', { code });
    io.to(code).emit('playerJoined', { playerCount: lobby.players.length });
    
    if (lobby.players.length === 2) {
      lobby.gameState = 'placing';
      lobby.currentTurn = lobby.players[0];
      io.to(code).emit('gameStart', { 
        message: 'Начните расставлять корабли',
        yourTurn: socket.id === lobby.currentTurn
      });
    }
  });

  // Отправка расстановки кораблей
  socket.on('placeShips', (data) => {
    const { code, ships } = data;
    const lobby = lobbies.get(code);
    
    if (!lobby) {
      socket.emit('error', { message: 'Лобби не найдено' });
      return;
    }
    
    if (!validateShipPlacement(ships)) {
      socket.emit('placementError', { message: 'Неверная расстановка кораблей' });
      return;
    }
    
    lobby.boards[socket.id] = {
      ships: ships,
      hits: [],
      misses: []
    };
    
    socket.emit('placementConfirmed');
    
    // Проверка, готовы ли оба игрока
    if (Object.keys(lobby.boards).length === 2) {
      lobby.gameState = 'playing';
      lobby.currentTurn = lobby.players[0];
      io.to(code).emit('allReady', { 
        currentTurn: lobby.currentTurn,
        message: 'Игра началась!'
      });
    }
  });

  // Выстрел
  socket.on('shoot', (data) => {
    const { code, row, col } = data;
    const lobby = lobbies.get(code);
    
    if (!lobby || lobby.gameState !== 'playing') {
      socket.emit('error', { message: 'Игра не началась' });
      return;
    }
    
    if (lobby.currentTurn !== socket.id) {
      socket.emit('error', { message: 'Не ваш ход' });
      return;
    }
    
    // Найти противника
    const opponentId = lobby.players.find(id => id !== socket.id);
    const opponentBoard = lobby.boards[opponentId];
    
    if (!opponentBoard) {
      socket.emit('error', { message: 'Противник не готов' });
      return;
    }
    
    // Проверка, не стреляли ли уже в эту клетку
    const alreadyShot = opponentBoard.hits.some(h => h.row === row && h.col === col) ||
                        opponentBoard.misses.some(m => m.row === row && m.col === col);
    
    if (alreadyShot) {
      socket.emit('error', { message: 'Вы уже стреляли в эту клетку' });
      return;
    }
    
    const result = checkHit(opponentBoard.ships, row, col);
    
    if (result.hit) {
      opponentBoard.hits.push({ row, col });
      const ship = result.ship;
      const isSunk = isShipSunk(ship, opponentBoard.hits);
      
      socket.emit('shotResult', { 
        row, 
        col, 
        hit: true, 
        sunk: isSunk,
        ship: isSunk ? ship : null
      });
      
      socket.to(opponentId).emit('opponentShot', { row, col, hit: true });
      
      // Проверка победы
      if (checkWin(opponentBoard.ships, opponentBoard.hits)) {
        lobby.gameState = 'finished';
        io.to(code).emit('gameOver', { winner: socket.id });
        return;
      }
      
      // Если корабль потоплен, ход остается у текущего игрока
      if (isSunk) {
        socket.emit('turnInfo', { yourTurn: true });
        socket.to(opponentId).emit('turnInfo', { yourTurn: false });
      } else {
        // Передача хода
        lobby.currentTurn = opponentId;
        socket.emit('turnInfo', { yourTurn: false });
        socket.to(opponentId).emit('turnInfo', { yourTurn: true });
      }
    } else {
      opponentBoard.misses.push({ row, col });
      socket.emit('shotResult', { row, col, hit: false });
      socket.to(opponentId).emit('opponentShot', { row, col, hit: false });
      
      // Передача хода
      lobby.currentTurn = opponentId;
      socket.emit('turnInfo', { yourTurn: false });
      socket.to(opponentId).emit('turnInfo', { yourTurn: true });
    }
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
    
    // Удаление из лобби
    for (const [code, lobby] of lobbies.entries()) {
      if (lobby.players.includes(socket.id)) {
        lobby.players = lobby.players.filter(id => id !== socket.id);
        if (lobby.players.length === 0) {
          lobbies.delete(code);
        } else {
          io.to(code).emit('playerLeft', { message: 'Игрок покинул игру' });
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте http://localhost:${PORT} в браузере`);
});

