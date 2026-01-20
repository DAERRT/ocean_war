const socket = io();

let currentLobbyCode = null;
let isHost = false;
let myBoard = [];
let opponentBoard = [];
let placedShips = [];
let selectedShip = null;
let isHorizontal = true;
let shipCounts = { 4: 1, 3: 2, 2: 3, 1: 4 };
let myTurn = false;
let gameState = 'lobby'; // lobby, placing, playing, finished

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    initializeLobby();
    initializePlacement();
    initializeGame();
});

// Лобби
function initializeLobby() {
    document.getElementById('createLobbyBtn').addEventListener('click', () => {
        socket.emit('createLobby');
        isHost = true;
    });

    document.getElementById('joinLobbyBtn').addEventListener('click', () => {
        const code = document.getElementById('lobbyCodeInput').value.trim().toUpperCase();
        if (code.length === 6) {
            socket.emit('joinLobby', { code });
            currentLobbyCode = code;
        } else {
            showError('Введите корректный код лобби (6 символов)');
        }
    });

    socket.on('lobbyCreated', (data) => {
        currentLobbyCode = data.code;
        document.getElementById('lobbyCodeDisplay').textContent = data.code;
        document.getElementById('lobbyInfo').classList.remove('hidden');
        document.getElementById('lobbyStatus').textContent = 'Ожидание игрока...';
    });

    socket.on('lobbyJoined', (data) => {
        currentLobbyCode = data.code;
        document.getElementById('lobbyCodeDisplay').textContent = data.code;
        document.getElementById('lobbyInfo').classList.remove('hidden');
        document.getElementById('lobbyStatus').textContent = 'Ожидание второго игрока...';
    });

    socket.on('playerJoined', (data) => {
        document.getElementById('lobbyStatus').textContent = `Игроков: ${data.playerCount}/2`;
    });

    socket.on('gameStart', (data) => {
        showScreen('placementScreen');
        gameState = 'placing';
        initializeBoard('yourBoard');
        resetShipCounts();
    });

    socket.on('lobbyError', (data) => {
        showError(data.message);
    });
}

// Расстановка кораблей
function initializePlacement() {
    // Выбор корабля
    document.querySelectorAll('.ship-selector').forEach(selector => {
        selector.addEventListener('click', () => {
            if (selector.classList.contains('disabled')) return;
            
            const size = parseInt(selector.dataset.size);
            const count = parseInt(selector.dataset.count);
            
            if (shipCounts[size] > 0) {
                document.querySelectorAll('.ship-selector').forEach(s => s.classList.remove('selected'));
                selector.classList.add('selected');
                selectedShip = { size, count };
                document.getElementById('placementStatus').textContent = 
                    `Выбран корабль размером ${size}. Кликните на поле для размещения.`;
            }
        });
    });

    // Поворот корабля
    document.getElementById('rotateBtn').addEventListener('click', () => {
        isHorizontal = !isHorizontal;
        updateShipPreviews();
    });

    // Подтверждение расстановки
    document.getElementById('confirmPlacementBtn').addEventListener('click', () => {
        if (placedShips.length !== 10) {
            showError('Расставьте все корабли!');
            return;
        }
        
        // Проверка количества кораблей каждого размера
        const shipSizes = placedShips.map(ship => ship.length);
        const requiredSizes = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
        const sortedSizes = [...shipSizes].sort((a, b) => b - a);
        const sortedRequired = [...requiredSizes].sort((a, b) => b - a);
        
        let isValid = true;
        for (let i = 0; i < sortedSizes.length; i++) {
            if (sortedSizes[i] !== sortedRequired[i]) {
                isValid = false;
                break;
            }
        }
        
        if (!isValid) {
            showError('Неверное количество кораблей! Проверьте расстановку.');
            return;
        }
        
        // Отправка на сервер
        socket.emit('placeShips', { code: currentLobbyCode, ships: placedShips });
        document.getElementById('confirmPlacementBtn').disabled = true;
    });

    socket.on('placementConfirmed', () => {
        document.getElementById('placementStatus').textContent = 'Расстановка подтверждена. Ожидание противника...';
        document.getElementById('confirmPlacementBtn').classList.add('hidden');
        document.getElementById('confirmPlacementBtn').disabled = false;
    });

    socket.on('placementError', (data) => {
        showError(data.message);
        document.getElementById('confirmPlacementBtn').disabled = false;
    });

    socket.on('allReady', (data) => {
        showScreen('gameScreen');
        gameState = 'playing';
        myTurn = socket.id === data.currentTurn;
        initializeGameBoards();
        updateGameStatus();
    });
}

// Игровая логика
function initializeGame() {
    socket.on('shotResult', (data) => {
        const cell = document.querySelector(`#opponentBoard .cell[data-row="${data.row}"][data-col="${data.col}"]`);
        if (cell) {
            if (data.hit) {
                cell.classList.add('hit');
                if (data.sunk) {
                    data.ship.forEach(cellPos => {
                        const sunkCell = document.querySelector(
                            `#opponentBoard .cell[data-row="${cellPos.row}"][data-col="${cellPos.col}"]`
                        );
                        if (sunkCell) sunkCell.classList.add('sunk');
                    });
                }
            } else {
                cell.classList.add('miss');
            }
            cell.classList.add('disabled');
            // Убираем курсор pointer, так как клетка уже использована
            cell.style.cursor = 'default';
        }
    });

    socket.on('opponentShot', (data) => {
        const cell = document.querySelector(`#yourGameBoard .cell[data-row="${data.row}"][data-col="${data.col}"]`);
        if (cell) {
            if (data.hit) {
                cell.classList.add('hit');
            } else {
                cell.classList.add('miss');
            }
        }
    });

    socket.on('turnInfo', (data) => {
        console.log('Получена информация о ходе:', data.yourTurn);
        myTurn = data.yourTurn;
        updateGameStatus();
    });

    socket.on('gameOver', (data) => {
        gameState = 'finished';
        const won = data.winner === socket.id;
        document.getElementById('gameOverMessage').textContent = 
            won ? '🎉 Поздравляем! Вы победили! 🎉' : '😔 Вы проиграли. Попробуйте еще раз!';
        showScreen('gameOverScreen');
    });

    socket.on('error', (data) => {
        console.log('Ошибка от сервера:', data.message);
        showError(data.message);
        // Если ошибка связана с ходом, обновляем статус
        if (data.message.includes('ход') || data.message.includes('Не ваш')) {
            // Возможно нужно обновить статус хода
            updateGameStatus();
        }
    });

    socket.on('playerLeft', (data) => {
        showError('Противник покинул игру');
        setTimeout(() => {
            location.reload();
        }, 3000);
    });

    document.getElementById('newGameBtn').addEventListener('click', () => {
        location.reload();
    });
}

// Создание игрового поля
function initializeBoard(boardId) {
    const board = document.getElementById(boardId);
    board.innerHTML = '';
    
    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            
            if (boardId === 'yourBoard') {
                cell.addEventListener('click', () => handlePlacementClick(row, col));
                cell.addEventListener('mouseenter', () => handlePlacementHover(row, col, cell));
                cell.addEventListener('mouseleave', () => handlePlacementHoverLeave(cell));
            }
            
            board.appendChild(cell);
        }
    }
}

function initializeGameBoards() {
    // Ваше поле
    const yourBoard = document.getElementById('yourGameBoard');
    yourBoard.innerHTML = '';
    
    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            
            // Отображаем размещенные корабли
            const hasShip = placedShips.some(ship => 
                ship.some(c => c.row === row && c.col === col)
            );
            if (hasShip) {
                cell.classList.add('ship');
            }
            
            yourBoard.appendChild(cell);
        }
    }

    // Поле противника
    const opponentBoard = document.getElementById('opponentBoard');
    opponentBoard.innerHTML = '';
    
    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            
            // Всегда добавляем обработчик клика, проверка будет внутри handleShoot
            cell.addEventListener('click', () => handleShoot(row, col, cell));
            
            // Если не наш ход, помечаем как disabled
            if (!myTurn) {
                cell.classList.add('disabled');
            }
            
            opponentBoard.appendChild(cell);
        }
    }
    
    // Обновляем статус для правильной активации/деактивации клеток
    updateGameStatus();
}

// Размещение кораблей
function handlePlacementClick(row, col) {
    if (!selectedShip || shipCounts[selectedShip.size] === 0) return;
    
    const shipCells = [];
    const valid = canPlaceShip(row, col, selectedShip.size, isHorizontal, shipCells);
    
    if (valid) {
        placedShips.push(shipCells);
        shipCounts[selectedShip.size]--;
        updateShipSelectors();
        renderPlacedShips();
        
        if (placedShips.length === 10) {
            document.getElementById('confirmPlacementBtn').classList.remove('hidden');
            document.getElementById('placementStatus').textContent = 'Все корабли расставлены! Подтвердите расстановку.';
        } else {
            document.getElementById('placementStatus').textContent = 
                `Корабль размещен. Осталось кораблей: ${10 - placedShips.length}/10`;
        }
        
        selectedShip = null;
        document.querySelectorAll('.ship-selector').forEach(s => s.classList.remove('selected'));
    } else {
        showError('Невозможно разместить корабль здесь!');
    }
}

function handlePlacementHover(row, col, cell) {
    if (!selectedShip || shipCounts[selectedShip.size] === 0) return;
    
    const shipCells = [];
    const valid = canPlaceShip(row, col, selectedShip.size, isHorizontal, shipCells);
    
    // Подсветка предпросмотра
    shipCells.forEach(pos => {
        const previewCell = document.querySelector(
            `#yourBoard .cell[data-row="${pos.row}"][data-col="${pos.col}"]`
        );
        if (previewCell && !previewCell.classList.contains('ship')) {
            previewCell.classList.add(valid ? 'placement-preview' : 'placement-invalid');
        }
    });
}

function handlePlacementHoverLeave(cell) {
    document.querySelectorAll('#yourBoard .cell').forEach(c => {
        c.classList.remove('placement-preview', 'placement-invalid');
    });
}

function canPlaceShip(row, col, size, horizontal, shipCells) {
    shipCells.length = 0;
    
    for (let i = 0; i < size; i++) {
        const r = horizontal ? row : row + i;
        const c = horizontal ? col + i : col;
        
        if (r < 0 || r >= 10 || c < 0 || c >= 10) return false;
        
        // Проверка на пересечение с существующими кораблями
        const hasConflict = placedShips.some(ship =>
            ship.some(cell => cell.row === r && cell.col === c)
        );
        if (hasConflict) return false;
        
        // Проверка на соседние клетки
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10) {
                    const hasNeighbor = placedShips.some(ship =>
                        ship.some(cell => cell.row === nr && cell.col === nc)
                    );
                    if (hasNeighbor) return false;
                }
            }
        }
        
        shipCells.push({ row: r, col: c });
    }
    
    return true;
}

function renderPlacedShips() {
    document.querySelectorAll('#yourBoard .cell').forEach(cell => {
        cell.classList.remove('ship');
    });
    
    placedShips.forEach(ship => {
        ship.forEach(cellPos => {
            const cell = document.querySelector(
                `#yourBoard .cell[data-row="${cellPos.row}"][data-col="${cellPos.col}"]`
            );
            if (cell) cell.classList.add('ship');
        });
    });
}

function updateShipSelectors() {
    document.querySelectorAll('.ship-selector').forEach(selector => {
        const size = parseInt(selector.dataset.size);
        if (shipCounts[size] === 0) {
            selector.classList.add('disabled');
        } else {
            selector.classList.remove('disabled');
        }
    });
}

function resetShipCounts() {
    shipCounts = { 4: 1, 3: 2, 2: 3, 1: 4 };
    placedShips = [];
    updateShipSelectors();
}

function updateShipPreviews() {
    document.querySelectorAll('.ship-preview').forEach(preview => {
        preview.className = `ship-preview ${isHorizontal ? 'horizontal' : 'vertical'}`;
        preview.innerHTML = '';
        const size = parseInt(preview.dataset.size);
        for (let i = 0; i < size; i++) {
            const div = document.createElement('div');
            preview.appendChild(div);
        }
    });
}

// Стрельба
function handleShoot(row, col, cell) {
    // Проверяем все условия перед выстрелом
    if (!myTurn) {
        console.log('Не ваш ход');
        return;
    }
    if (gameState !== 'playing') {
        console.log('Игра не началась');
        return;
    }
    if (cell.classList.contains('hit') || cell.classList.contains('miss')) {
        console.log('Уже стреляли в эту клетку');
        return;
    }
    if (cell.classList.contains('disabled') && (cell.classList.contains('hit') || cell.classList.contains('miss'))) {
        return;
    }
    
    console.log('Выстрел:', row, col);
    socket.emit('shoot', { code: currentLobbyCode, row, col });
    // Временно блокируем клетку до получения результата
    cell.classList.add('disabled');
}

function updateGameStatus() {
    const statusEl = document.getElementById('gameStatus');
    const indicatorEl = document.getElementById('turnIndicator');
    
    console.log('Обновление статуса игры, myTurn:', myTurn);
    
    if (myTurn) {
        statusEl.textContent = 'Ваш ход!';
        statusEl.style.color = '#48bb78';
        indicatorEl.textContent = 'Выберите клетку на поле противника';
        
        // Включаем клики на поле противника
        document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
            // Активируем только те клетки, в которые еще не стреляли
            if (!cell.classList.contains('hit') && !cell.classList.contains('miss')) {
                cell.classList.remove('disabled');
                cell.style.cursor = 'pointer';
                cell.style.pointerEvents = 'auto';
            } else {
                // Клетки, в которые уже стреляли, остаются заблокированными
                cell.classList.add('disabled');
                cell.style.cursor = 'default';
                cell.style.pointerEvents = 'none';
            }
        });
    } else {
        statusEl.textContent = 'Ход противника';
        statusEl.style.color = '#f56565';
        indicatorEl.textContent = 'Ожидайте хода противника...';
        
        // Отключаем клики на поле противника
        document.querySelectorAll('#opponentBoard .cell').forEach(cell => {
            // Если в клетку еще не стреляли, блокируем её
            if (!cell.classList.contains('hit') && !cell.classList.contains('miss')) {
                cell.classList.add('disabled');
                cell.style.cursor = 'not-allowed';
                cell.style.pointerEvents = 'none';
            }
        });
    }
}

// Утилиты
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    
    setTimeout(() => {
        errorEl.classList.add('hidden');
    }, 5000);
}

