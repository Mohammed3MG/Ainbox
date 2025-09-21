import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';

const TEXT_COLORS = [
  '#000000', '#FF0000', '#0000FF', '#008000', '#FF8C00', '#800080',
  '#666666', '#FF69B4', '#00CED1', '#32CD32', '#FFD700', '#9370DB',
  '#333333', '#DC143C', '#4169E1', '#228B22', '#FF4500', '#8A2BE2'
];

const BACKGROUND_COLORS = [
  '#FFFFFF', '#FFFF99', '#FFE6E6', '#E6F3FF', '#E6FFE6', '#F3E6FF',
  '#F0F0F0', '#FFF2CC', '#FFCCCC', '#CCE6FF', '#CCFFCC', '#E6CCFF',
  '#E0E0E0', '#FFEB99', '#FFB3B3', '#99D6FF', '#99FF99', '#D199FF'
];

export default function MiniColorPicker({
  type = 'text', // 'text' or 'background'
  onColorSelect,
  buttonContent,
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState(type === 'text' ? '#000000' : '#FFFFFF');
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  const colors = type === 'text' ? TEXT_COLORS : BACKGROUND_COLORS;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target) &&
          buttonRef.current && !buttonRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleColorClick = (color) => {
    setSelectedColor(color);
    onColorSelect(color);
    setIsOpen(false);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-center w-7 h-7 border border-gray-300 rounded-sm hover:border-gray-400 transition-colors bg-white shadow-sm",
          isOpen && "border-blue-500 shadow-md"
        )}
        title={`${type === 'text' ? 'Text' : 'Background'} color`}
        aria-label={`${type === 'text' ? 'Text' : 'Background'} color picker`}
        aria-expanded={isOpen}
      >
        {buttonContent ? buttonContent : (
          <div className="relative w-full h-full">
            {type === 'text' ? (
              <div className="flex flex-col items-center justify-center w-full h-full">
                <span
                  className="text-sm font-bold leading-none"
                  style={{ color: selectedColor }}
                >
                  A
                </span>
                <div
                  className="w-4 h-0.5 mt-0.5"
                  style={{ backgroundColor: selectedColor }}
                />
              </div>
            ) : (
              <div className="relative w-full h-full">
                <div className="w-4 h-3 m-auto mt-1 rounded-sm border border-gray-400" style={{ backgroundColor: selectedColor }} />
              </div>
            )}
          </div>
        )}
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full mb-1 left-0 bg-white border border-gray-300 rounded-lg shadow-lg p-2 z-50 animate-in slide-in-from-bottom-1 duration-150"
          style={{ minWidth: '120px' }}
        >
          <div className="grid grid-cols-6 gap-1">
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => handleColorClick(color)}
                className={cn(
                  "w-4 h-4 border border-gray-300 rounded-sm hover:border-gray-400 hover:scale-110 transition-all",
                  selectedColor === color && "ring-2 ring-blue-500 ring-offset-1"
                )}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>

          {/* Current color display */}
          <div className="mt-2 pt-2 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 border border-gray-300 rounded-sm"
                style={{ backgroundColor: selectedColor }}
              />
              <span className="text-xs text-gray-600 font-mono">
                {selectedColor.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}