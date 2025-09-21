import React from 'react';
import { Button } from '../ui/button';

const COLORS = [
  '#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#FFFFFF',
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080',
  '#FF4444', '#44FF44', '#4444FF', '#FFFF44', '#FF44FF', '#44FFFF',
  '#CC0000', '#00CC00', '#0000CC', '#CCCC00', '#CC00CC', '#00CCCC',
  '#880000', '#008800', '#000088', '#888800', '#880088', '#008888'
];

export default function ColorPicker({ onColorSelect, onClose }) {
  return (
    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 p-2">
      <div className="grid grid-cols-6 gap-1 mb-2">
        {COLORS.map((color) => (
          <Button
            key={color}
            variant="ghost"
            size="sm"
            onClick={() => onColorSelect(color)}
            className="p-0 h-8 w-8 border border-gray-300 hover:border-gray-400"
            style={{ backgroundColor: color }}
            title={color}
            aria-label={`Select color ${color}`}
          />
        ))}
      </div>

      <div className="flex justify-end pt-2 border-t border-gray-200">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-xs"
        >
          Close
        </Button>
      </div>
    </div>
  );
}