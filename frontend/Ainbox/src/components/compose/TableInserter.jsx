import React, { useState } from 'react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

export default function TableInserter({ onTableInsert, onClose }) {
  const [hoveredCell, setHoveredCell] = useState({ row: 0, col: 0 });
  const maxRows = 10;
  const maxCols = 10;

  const handleCellClick = (row, col) => {
    onTableInsert(row + 1, col + 1);
  };

  const handleCellHover = (row, col) => {
    setHoveredCell({ row, col });
  };

  return (
    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 p-3">
      <div className="mb-2">
        <p className="text-sm font-medium text-gray-700 mb-1">Insert Table</p>
        <p className="text-xs text-gray-500">
          {hoveredCell.row + 1} × {hoveredCell.col + 1} table
        </p>
      </div>

      <div className="grid grid-cols-10 gap-1 mb-3">
        {Array.from({ length: maxRows }, (_, row) =>
          Array.from({ length: maxCols }, (_, col) => (
            <div
              key={`${row}-${col}`}
              className={cn(
                "w-4 h-4 border border-gray-300 cursor-pointer",
                row <= hoveredCell.row && col <= hoveredCell.col
                  ? "bg-blue-200 border-blue-400"
                  : "bg-white hover:bg-gray-100"
              )}
              onMouseEnter={() => handleCellHover(row, col)}
              onClick={() => handleCellClick(row, col)}
              title={`Insert ${row + 1}×${col + 1} table`}
            />
          ))
        )}
      </div>

      <div className="flex justify-end pt-2 border-t border-gray-200">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-xs"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}