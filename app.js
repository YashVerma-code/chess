/* ============================================================
   CHESS ENGINE
   Board representation: 8x8 array, board[row][col]
   row 0 = rank 8 (top, black side), row 7 = rank 1 (bottom, white side)
   col 0 = file a, col 7 = file h
   Each square is null or { type: 'P'|'N'|'B'|'R'|'Q'|'K', color: 'w'|'b' }

   This section (engine) has no DOM dependencies at all, so it can be
   reused as-is if you later add an AI: just call getLegalMoves() to
   enumerate options and makeMove() to apply whichever one the engine
   picks.
   ============================================================ */

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

function squareName(row, col) {
  return FILES[col] + (8 - row);
}

function inBounds(r, c) { 
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function cloneBoard(board) {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

function createInitialBoard() {
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: back[c], color: "b" };
    board[1][c] = { type: "P", color: "b" };
    board[6][c] = { type: "P", color: "w" };
    board[7][c] = { type: back[c], color: "w" };
  }
  return board;
}

function createInitialState() {
  return {
    board: createInitialBoard(),
    turn: "w",
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null, // {row, col} square a pawn can move to, capturing en passant
    captured: { w: [], b: [] }, // pieces captured BY white / BY black
    history: [],
    lastMove: null,
    gameOver: false,
  };
}

const SLIDING_DIRS = {
  B: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  R: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  Q: [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]],
};
const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
];

// Pseudo-legal moves for the piece at (r,c): ignores whether the move
// leaves the mover's own king in check. Returns array of move objects.
function getPseudoMoves(state, r, c) {
  const board = state.board;
  const piece = board[r][c];
  if (!piece) return [];
  const moves = [];
  const enemy = piece.color === "w" ? "b" : "w";

  const addMove = (tr, tc, extra = {}) => {
    moves.push({ from: { row: r, col: c }, to: { row: tr, col: tc }, piece, ...extra });
  };

  if (piece.type === "P") {
    const dir = piece.color === "w" ? -1 : 1;
    const startRow = piece.color === "w" ? 6 : 1;
    const promoRow = piece.color === "w" ? 0 : 7;

    // forward one
    if (inBounds(r + dir, c) && !board[r + dir][c]) {
      if (r + dir === promoRow) {
        ["Q", "R", "B", "N"].forEach((pt) => addMove(r + dir, c, { promotion: pt }));
      } else {
        addMove(r + dir, c);
      }
      // forward two from start
      if (r === startRow && !board[r + 2 * dir][c]) {
        addMove(r + 2 * dir, c, { doubleStep: true });
      }
    }
    // captures
    for (const dc of [-1, 1]) {
      const tr = r + dir, tc = c + dc;
      if (!inBounds(tr, tc)) continue;
      const target = board[tr][tc];
      if (target && target.color === enemy) {
        if (tr === promoRow) {
          ["Q", "R", "B", "N"].forEach((pt) => addMove(tr, tc, { capture: true, promotion: pt }));
        } else {
          addMove(tr, tc, { capture: true });
        }
      } else if (
        state.enPassant &&
        state.enPassant.row === tr &&
        state.enPassant.col === tc
      ) {
        addMove(tr, tc, { capture: true, enPassant: true });
      }
    }
  } else if (piece.type === "N") {
    for (const [dr, dc] of KNIGHT_OFFSETS) {
      const tr = r + dr, tc = c + dc;
      if (!inBounds(tr, tc)) continue;
      const target = board[tr][tc];
      if (!target) addMove(tr, tc);
      else if (target.color === enemy) addMove(tr, tc, { capture: true });
    }
  } else if (piece.type === "B" || piece.type === "R" || piece.type === "Q") {
    for (const [dr, dc] of SLIDING_DIRS[piece.type]) {
      let tr = r + dr, tc = c + dc;
      while (inBounds(tr, tc)) {
        const target = board[tr][tc];
        if (!target) {
          addMove(tr, tc);
        } else {
          if (target.color === enemy) addMove(tr, tc, { capture: true });
          break;
        }
        tr += dr;
        tc += dc;
      }
    }
  } else if (piece.type === "K") {
    for (const [dr, dc] of KING_OFFSETS) {
      const tr = r + dr, tc = c + dc;
      if (!inBounds(tr, tc)) continue;
      const target = board[tr][tc];
      if (!target) addMove(tr, tc);
      else if (target.color === enemy) addMove(tr, tc, { capture: true });
    }
    // castling
    const row = piece.color === "w" ? 7 : 0;
    if (r === row && c === 4) {
      const kSideKey = piece.color === "w" ? "wK" : "bK";
      const qSideKey = piece.color === "w" ? "wQ" : "bQ";
      if (
        state.castling[kSideKey] &&
        !board[row][5] && !board[row][6] &&
        board[row][7] && board[row][7].type === "R" && board[row][7].color === piece.color &&
        !isSquareAttacked(state, row, 4, enemy) &&
        !isSquareAttacked(state, row, 5, enemy) &&
        !isSquareAttacked(state, row, 6, enemy)
      ) {
        addMove(row, 6, { castle: "K" });
      }
      if (
        state.castling[qSideKey] &&
        !board[row][3] && !board[row][2] && !board[row][1] &&
        board[row][0] && board[row][0].type === "R" && board[row][0].color === piece.color &&
        !isSquareAttacked(state, row, 4, enemy) &&
        !isSquareAttacked(state, row, 3, enemy) &&
        !isSquareAttacked(state, row, 2, enemy)
      ) {
        addMove(row, 2, { castle: "Q" });
      }
    }
  }

  return moves;
}

// Is (r,c) attacked by any piece of color `byColor`?
function isSquareAttacked(state, r, c, byColor) {
  const board = state.board;
  // Pawn attacks
  const pawnDir = byColor === "w" ? 1 : -1; // a white pawn attacks upward (toward row-1), so look from target's perspective
  for (const dc of [-1, 1]) {
    const pr = r + pawnDir, pc = c + dc;
    if (inBounds(pr, pc)) {
      const p = board[pr][pc];
      if (p && p.type === "P" && p.color === byColor) return true;
    }
  }
  // Knight attacks
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const tr = r + dr, tc = c + dc;
    if (inBounds(tr, tc)) {
      const p = board[tr][tc];
      if (p && p.type === "N" && p.color === byColor) return true;
    }
  }
  // King attacks
  for (const [dr, dc] of KING_OFFSETS) {
    const tr = r + dr, tc = c + dc;
    if (inBounds(tr, tc)) {
      const p = board[tr][tc];
      if (p && p.type === "K" && p.color === byColor) return true;
    }
  }
  // Sliding: bishop/queen diagonals
  for (const [dr, dc] of SLIDING_DIRS.B) {
    let tr = r + dr, tc = c + dc;
    while (inBounds(tr, tc)) {
      const p = board[tr][tc];
      if (p) {
        if (p.color === byColor && (p.type === "B" || p.type === "Q")) return true;
        break;
      }
      tr += dr; tc += dc;
    }
  }
  // Sliding: rook/queen straight lines
  for (const [dr, dc] of SLIDING_DIRS.R) {
    let tr = r + dr, tc = c + dc;
    while (inBounds(tr, tc)) {
      const p = board[tr][tc];
      if (p) {
        if (p.color === byColor && (p.type === "R" || p.type === "Q")) return true;
        break;
      }
      tr += dr; tc += dc;
    }
  }
  return false;
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === "K" && p.color === color) return { row: r, col: c };
    }
  }
  return null;
}

function isInCheck(state, color) {
  const king = findKing(state.board, color);
  if (!king) return false;
  return isSquareAttacked(state, king.row, king.col, color === "w" ? "b" : "w");
}

// Apply a move to a (cloned) state in place, without any legality checks.
function applyMoveRaw(state, move) {
  const { from, to, piece } = move;
  const board = state.board;
  const movingColor = piece.color;

  let captured = null;
  if (move.enPassant) {
    const capRow = movingColor === "w" ? to.row + 1 : to.row - 1;
    captured = board[capRow][to.col];
    board[capRow][to.col] = null;
  } else if (board[to.row][to.col]) {
    captured = board[to.row][to.col];
  }

  board[to.row][to.col] = { type: piece.type, color: piece.color };
  board[from.row][from.col] = null;

  if (move.promotion) {
    board[to.row][to.col].type = move.promotion;
  }

  if (move.castle === "K") {
    const row = from.row;
    board[row][5] = board[row][7];
    board[row][7] = null;
  } else if (move.castle === "Q") {
    const row = from.row;
    board[row][3] = board[row][0];
    board[row][0] = null;
  }

  // update castling rights
  if (piece.type === "K") {
    if (movingColor === "w") { state.castling.wK = false; state.castling.wQ = false; }
    else { state.castling.bK = false; state.castling.bQ = false; }
  }
  if (piece.type === "R") {
    if (movingColor === "w" && from.row === 7 && from.col === 0) state.castling.wQ = false;
    if (movingColor === "w" && from.row === 7 && from.col === 7) state.castling.wK = false;
    if (movingColor === "b" && from.row === 0 && from.col === 0) state.castling.bQ = false;
    if (movingColor === "b" && from.row === 0 && from.col === 7) state.castling.bK = false;
  }
  // if a rook is captured on its home square, lose that castling right too
  if (captured && captured.type === "R") {
    if (to.row === 7 && to.col === 0) state.castling.wQ = false;
    if (to.row === 7 && to.col === 7) state.castling.wK = false;
    if (to.row === 0 && to.col === 0) state.castling.bQ = false;
    if (to.row === 0 && to.col === 7) state.castling.bK = false;
  }

  // update en passant target
  if (move.doubleStep) {
    state.enPassant = { row: (from.row + to.row) / 2, col: from.col };
  } else {
    state.enPassant = null;
  }

  return captured;
}

// Legal moves for the piece at (r,c): pseudo-legal moves filtered to
// exclude any that leave the mover's own king in check.
function getLegalMoves(state, r, c) {
  const piece = state.board[r][c];
  if (!piece) return [];
  const pseudo = getPseudoMoves(state, r, c);
  const legal = [];
  for (const move of pseudo) {
    const testState = {
      board: cloneBoard(state.board),
      turn: state.turn,
      castling: { ...state.castling },
      enPassant: state.enPassant ? { ...state.enPassant } : null,
    };
    applyMoveRaw(testState, move);
    if (!isInCheck(testState, piece.color)) legal.push(move);
  }
  return legal;
}

function getAllLegalMoves(state, color) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && p.color === color) {
        moves.push(...getLegalMoves(state, r, c));
      }
    }
  }
  return moves;
}

function pieceLetterForNotation(type) {
  return type === "P" ? "" : type;
}

function moveToNotation(move, state, isCheck, isMate) {
  if (move.castle === "K") return isMate ? "O-O#" : isCheck ? "O-O+" : "O-O";
  if (move.castle === "Q") return isMate ? "O-O-O#" : isCheck ? "O-O-O+" : "O-O-O";

  let notation = "";
  const fromFile = FILES[move.from.col];
  if (move.piece.type === "P") {
    if (move.capture) notation += fromFile + "x";
    notation += squareName(move.to.row, move.to.col);
    if (move.promotion) notation += "=" + move.promotion;
  } else {
    notation += pieceLetterForNotation(move.piece.type);
    if (move.capture) notation += "x";
    notation += squareName(move.to.row, move.to.col);
  }
  if (isMate) notation += "#";
  else if (isCheck) notation += "+";
  return notation;
}

// Apply a move to the real game state: mutates captured list, history,
// turn, lastMove, and gameOver/status. Returns a result summary.
function makeMove(state, move) {
  const movingColor = move.piece.color;
  const captured = applyMoveRaw(state, move);
  if (captured) {
    state.captured[movingColor === "w" ? "w" : "b"].push(captured);
  }

  state.turn = movingColor === "w" ? "b" : "w";
  const opponent = state.turn;
  const inCheck = isInCheck(state, opponent);
  const opponentMoves = getAllLegalMoves(state, opponent);
  const isMate = inCheck && opponentMoves.length === 0;
  const isStalemate = !inCheck && opponentMoves.length === 0;

  const notation = moveToNotation(move, state, inCheck, isMate);
  state.history.push(notation);
  state.lastMove = { from: move.from, to: move.to };

  let status;
  if (isMate) {
    state.gameOver = true;
    status = `Checkmate! ${movingColor === "w" ? "White" : "Black"} wins.`;
  } else if (isStalemate) {
    state.gameOver = true;
    status = "Stalemate! The game is a draw.";
  } else if (inCheck) {
    status = `${opponent === "w" ? "White" : "Black"} is in check.`;
  } else {
    status = `${opponent === "w" ? "White" : "Black"} to move.`;
  }

  return { captured, inCheck, isMate, isStalemate, status };
}

/* ============================================================
   UI LAYER
   ============================================================ */

const PIECE_GLYPHS = {
  w: { K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659" },
  b: { K: "\u265A", Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F" },
};

let state = createInitialState();
let selected = null; // {row, col}
let selectedMoves = []; // legal moves for the selected piece
let gameActive = false;
let draggingFrom = null;

const boardEl = document.getElementById("board");
const statusText = document.getElementById("statusText");
const startBtn = document.getElementById("startBtn");
const capturedByWhiteEl = document.getElementById("capturedByWhite");
const capturedByBlackEl = document.getElementById("capturedByBlack");
const moveHistoryEl = document.getElementById("moveHistory");
const promoModal = document.getElementById("promoModal");
const promoChoices = document.getElementById("promoChoices");

function setStatus(text, mode) {
  statusText.textContent = text;
  statusText.classList.remove("check", "gameover");
  if (mode) statusText.classList.add(mode);
}

function renderCaptured() {
  capturedByWhiteEl.textContent = state.captured.w
    .map((p) => PIECE_GLYPHS.b[p.type])
    .join(" ");
  capturedByBlackEl.textContent = state.captured.b
    .map((p) => PIECE_GLYPHS.w[p.type])
    .join(" ");
}

function renderHistory() {
  moveHistoryEl.innerHTML = "";
  for (let i = 0; i < state.history.length; i += 2) {
    const li = document.createElement("li");
    const whiteMove = state.history[i] || "";
    const blackMove = state.history[i + 1] || "";
    li.textContent = blackMove ? `${whiteMove}  ${blackMove}` : whiteMove;
    moveHistoryEl.appendChild(li);
  }
}

function render() {
  boardEl.innerHTML = "";
  const kingInCheckSquare =
    !state.gameOver && isInCheck(state, state.turn) ? findKing(state.board, state.turn) : null;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement("div");
      sq.className = "square " + ((r + c) % 2 === 0 ? "light" : "dark");
      sq.dataset.row = r;
      sq.dataset.col = c;

      if (state.lastMove) {
        const { from, to } = state.lastMove;
        if ((r === from.row && c === from.col) || (r === to.row && c === to.col)) {
          sq.classList.add("last-move");
        }
      }
      if (selected && selected.row === r && selected.col === c) {
        sq.classList.add("selected");
      }
      if (kingInCheckSquare && kingInCheckSquare.row === r && kingInCheckSquare.col === c) {
        sq.classList.add("in-check");
      }

      const piece = state.board[r][c];
      if (piece) {
        const span = document.createElement("span");
        span.textContent = PIECE_GLYPHS[piece.color][piece.type];
        span.className = "piece " + (piece.color === "w" ? "white" : "black");
        const isMovable = gameActive && !state.gameOver && piece.color === state.turn;
        span.draggable = isMovable;
        if (!isMovable) span.classList.add("disabled");
        sq.appendChild(span);
      }

      const moveHere = selectedMoves.find((m) => m.to.row === r && m.to.col === c);
      if (moveHere) {
        const marker = document.createElement("div");
        marker.className = moveHere.capture ? "ring" : "dot";
        sq.appendChild(marker);
      }

      sq.addEventListener("click", () => onSquareClick(r, c));
      sq.addEventListener("dragover", (e) => e.preventDefault());
      sq.addEventListener("drop", (e) => onSquareDrop(e, r, c));
      boardEl.appendChild(sq);
    }
  }

  boardEl.querySelectorAll(".piece[draggable='true']").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      const parentSq = e.target.closest(".square");
      draggingFrom = { row: Number(parentSq.dataset.row), col: Number(parentSq.dataset.col) };
      selectSquare(draggingFrom.row, draggingFrom.col);
    });
  });

  renderCaptured();
  renderHistory();
}

function selectSquare(r, c) {
  const piece = state.board[r][c];
  if (!piece || piece.color !== state.turn) return;
  selected = { row: r, col: c };
  selectedMoves = getLegalMoves(state, r, c);
  render();
}

function clearSelection() {
  selected = null;
  selectedMoves = [];
}

function onSquareClick(r, c) {
  if (!gameActive || state.gameOver) return;

  if (selected) {
    const move = selectedMoves.find((m) => m.to.row === r && m.to.col === c);
    if (move) {
      attemptMove(move);
      return;
    }
    // clicking another own piece re-selects instead of moving
    const piece = state.board[r][c];
    if (piece && piece.color === state.turn) {
      selectSquare(r, c);
      return;
    }
    clearSelection();
    render();
    return;
  }

  selectSquare(r, c);
}

function onSquareDrop(e, r, c) {
  e.preventDefault();
  if (!gameActive || state.gameOver || !draggingFrom) return;
  const move = selectedMoves.find((m) => m.to.row === r && m.to.col === c);
  draggingFrom = null;
  if (move) attemptMove(move);
  else {
    clearSelection();
    render();
  }
}

function attemptMove(move) {
  if (move.promotion && move.promotion !== "Q") return; // real choice made via modal below
  const promotionCandidates = selectedMoves.filter(
    (m) => m.to.row === move.to.row && m.to.col === move.to.col && m.promotion
  );
  clearSelection();

  if (promotionCandidates.length > 1) {
    showPromotionModal(promotionCandidates);
    return;
  }

  finalizeMove(move);
}

function showPromotionModal(candidates) {
  promoChoices.innerHTML = "";
  const color = candidates[0].piece.color;
  ["Q", "R", "B", "N"].forEach((type) => {
    const btn = document.createElement("button");
    btn.textContent = PIECE_GLYPHS[color][type];
    btn.addEventListener("click", () => {
      const chosen = candidates.find((m) => m.promotion === type);
      promoModal.classList.add("hidden");
      finalizeMove(chosen);
    });
    promoChoices.appendChild(btn);
  });
  promoModal.classList.remove("hidden");
}

function finalizeMove(move) {
  const result = makeMove(state, move);
  render();
  if (result.isMate) {
    setStatus(result.status, "gameover");
    gameActive = false;
    startBtn.textContent = "Play Again";
    startBtn.disabled = false;
  } else if (result.isStalemate) {
    setStatus(result.status, "gameover");
    gameActive = false;
    startBtn.textContent = "Play Again";
    startBtn.disabled = false;
  } else if (result.inCheck) {
    setStatus(result.status, "check");
  } else {
    setStatus(result.status);
  }
}

function startGame() {
  state = createInitialState();
  clearSelection();
  gameActive = true;
  startBtn.textContent = "Restart";
  startBtn.disabled = false;
  setStatus("White to move.");
  render();
}

startBtn.addEventListener("click", startGame);

// Initial static render (board visible but not yet playable)
render();
setStatus("Press start to begin. White moves first.");