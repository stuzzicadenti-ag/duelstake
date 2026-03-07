export function calculateElo(winnerElo, loserElo, kFactor = 32) {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));
  return {
    winnerNew: Math.round(winnerElo + kFactor * (1 - expectedWinner)),
    loserNew: Math.round(loserElo + kFactor * (0 - expectedLoser)),
  };
}
