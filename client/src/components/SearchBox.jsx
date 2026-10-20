import { useEffect, useRef, useState } from 'react';
import { Search, X, CornerDownLeft } from 'lucide-react';

export default function SearchBox({ value, onChange, matches = [], onSelectMatch }) {
  const inputRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => { setActiveIndex(0); }, [value]);
  useEffect(() => {
    const handleShortcut = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); inputRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        onChange(''); inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [onChange]);

  const choose = match => { if (match) onSelectMatch?.(match); };
  const handleKeyDown = event => {
    if (event.key === 'ArrowDown' && matches.length) { event.preventDefault(); setActiveIndex(i => Math.min(matches.length - 1, i + 1)); }
    else if (event.key === 'ArrowUp' && matches.length) { event.preventDefault(); setActiveIndex(i => Math.max(0, i - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(matches[activeIndex] || matches[0]); }
  };

  return <div className="search-box"><Search size={15}/><input ref={inputRef} value={value} onChange={e => onChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="Search files, functions..." aria-label="Search repository" aria-autocomplete="list"/><kbd>⌘ K</kbd>{value && <button aria-label="Clear search" onClick={() => onChange('')}><X size={13}/></button>}{value && matches.length > 0 && <div className="search-popover" role="listbox">{matches.slice(0,8).map((match,index)=><button key={`${match.type}-${match.id}`} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'search-active' : ''} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(match)}><span className="search-result-icon">{match.type === 'function' ? 'ƒ' : 'F'}</span><span><b>{match.label}</b><small>{match.file || match.id}</small></span><CornerDownLeft size={12}/></button>)}</div>}</div>;
}
