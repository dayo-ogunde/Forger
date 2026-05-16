import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import JSZip from 'jszip';
import { 
  Box, 
  Trash2, 
  Download, 
  Wand2, 
  RotateCcw, 
  Settings2,
  Search,
  Undo2,
  Redo2,
  Check,
  LayoutGrid,
  Plus,
  Eraser,
  Pencil,
  User,
  Ruler,
  Maximize2,
  Palette,
  Library,
  Save,
  Pipette,
  PaintBucket,
  Maximize,
  Grid,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Move,
  X,
  Clock,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Minus,
  Database,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types & Constants ---

const GRID_SIZE = 16;
const MAX_INSTANCES = 8192;

type Category = 'WOOD' | 'STONE' | 'WOOL' | 'SPECIAL' | 'CUSTOM';
type Tool = 'pencil' | 'eraser' | 'fill' | 'line' | 'box' | 'eyedropper';

interface BlockConfig {
  id: string;
  name: string;
  category: Category;
  color: string;
  roughness: number;
  metalness: number;
}

const PRESET_BLOCKS: BlockConfig[] = [
  { id: 'oak_planks', name: 'Oak Planks', category: 'WOOD', color: '#9d814d', roughness: 0.9, metalness: 0.0 },
  { id: 'oak_log', name: 'Oak Log', category: 'WOOD', color: '#5a4a35', roughness: 0.95, metalness: 0.0 },
  { id: 'spruce_planks', name: 'Spruce Planks', category: 'WOOD', color: '#684e2e', roughness: 0.9, metalness: 0.0 },
  { id: 'stone', name: 'Stone', category: 'STONE', color: '#7d7d7d', roughness: 0.9, metalness: 0.0 },
  { id: 'cobblestone', name: 'Cobblestone', category: 'STONE', color: '#6e6e6e', roughness: 1.0, metalness: 0.0 },
  { id: 'white_wool', name: 'White Wool', category: 'WOOL', color: '#e4e4e4', roughness: 1.0, metalness: 0.0 },
  { id: 'red_wool', name: 'Red Wool', category: 'WOOL', color: '#9e2b27', roughness: 1.0, metalness: 0.0 },
  { id: 'blue_wool', name: 'Blue Wool', category: 'WOOL', color: '#334cb2', roughness: 1.0, metalness: 0.0 },
  { id: 'gold_block', name: 'Gold Block', category: 'SPECIAL', color: '#f9d846', roughness: 0.1, metalness: 1.0 },
  { id: 'glass', name: 'Glass', category: 'SPECIAL', color: '#add8e6', roughness: 0.0, metalness: 0.0 },
  // More presets can be added, but keeping it concise for token limits
];

interface Voxel {
  x: number;
  y: number;
  z: number;
  block: string;
  isCustom?: boolean;
}

interface SavedDesign {
  id: string;
  name: string;
  voxels: Record<string, Voxel>;
  thumbnail: string;
  prompt: string;
  timestamp: number;
  dimensions: { w: number, h: number, d: number };
  voxelCount: number;
}

// --- Utils ---

const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => (c === 'x' ? (Math.random() * 16 | 0) : (Math.random() * 16 | 0 & 0x3 | 0x8)).toString(16));

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 0, b: 0 };
};

const rgbToHex = (r: number, g: number, b: number) => "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);

// --- Storage Helpers ---
const STORAGE_KEYS = {
  LIBRARY: 'bitforge_library_v1',
  UUIDS: 'bitforge_pack_uuids',
  AUTOSAVE: 'bitforge_autosave',
  COLLECTION_NAME: 'bitforge_collection_name',
  TAB_ICON: 'bitforge_tab_icon'
};

function loadStorage<T>(key: string, def: T): T {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : def;
}

const saveStorage = (key: string, data: any) => localStorage.setItem(key, JSON.stringify(data));

// --- Components ---

const PixelEditor = ({ value, onChange, color, tool, onColorPick }: { value: string[], onChange: (v: string[]) => void, color: string, tool: Tool, onColorPick?: (c: string) => void }) => {
  const grid = useMemo(() => value.length === 256 ? value : Array(256).fill('transparent'), [value]);

  const handlePaint = (idx: number, isRight: boolean) => {
    const next = [...grid];
    const activeTool = isRight ? 'eraser' : tool;

    if (activeTool === 'pencil') {
      next[idx] = color;
    } else if (activeTool === 'eraser') {
      next[idx] = 'transparent';
    } else if (activeTool === 'eyedropper') {
      if (grid[idx] !== 'transparent' && onColorPick) {
        onColorPick(grid[idx]);
      }
      return;
    } else if (activeTool === 'fill') {
      const targetColor = grid[idx];
      const queue = [idx];
      const visited = new Set([idx]);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        next[curr] = color;
        const neighbors = [
          curr - 1, curr + 1, curr - 16, curr + 16
        ].filter(n => {
          if (n < 0 || n >= 256 || visited.has(n)) return false;
          if (Math.abs(n - curr) === 1 && Math.floor(n / 16) !== Math.floor(curr / 16)) return false;
          return grid[n] === targetColor;
        });
        neighbors.forEach(n => {
          visited.add(n);
          queue.push(n);
        });
      }
    }
    onChange(next);
  };

  return (
    <div className="grid grid-cols-16 gap-0 border border-white/10 w-fit cursor-crosshair select-none bg-black/40 rounded overflow-hidden" onContextMenu={e => e.preventDefault()}>
      {grid.map((c, i) => (
        <div 
          key={i} 
          className="w-3.5 h-3.5 border-[0.5px] border-white/5" 
          style={{ backgroundColor: c === 'transparent' ? 'transparent' : c }}
          onPointerDown={e => handlePaint(i, e.button === 2)}
          onPointerEnter={e => { if (e.buttons === 1) handlePaint(i, false); if (e.buttons === 2) handlePaint(i, true); }}
        />
      ))}
    </div>
  );
};

const Modal = ({ children, onClose, title }: { children: React.ReactNode, onClose: () => void, title: string }) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
      <div className="flex items-center justify-between p-6 border-b border-white/5">
        <h3 className="text-sm font-black uppercase tracking-widest text-indigo-400">{title}</h3>
        <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
      </div>
      <div className="p-6">{children}</div>
    </motion.div>
  </div>
);

// --- App ---

export default function App() {
  const [voxels, setVoxels] = useState<Record<string, Voxel>>({});
  const [history, setHistory] = useState<Record<string, Voxel>[]>([]);
  const [redoStack, setRedoStack] = useState<Record<string, Voxel>[]>([]);
  
  // Selection
  const [selectedBlock, setSelectedBlock] = useState(PRESET_BLOCKS[0].id);
  const [isCustomSelected, setIsCustomSelected] = useState(false);
  const [customColor, setCustomColor] = useState('#4f46e5');
  const [swatches, setSwatches] = useState<string[]>([]);
  
  // Settings
  const [voxelScale, setVoxelScale] = useState(1.0);
  const [activeTool, setActiveTool] = useState<Tool>('pencil');
  const [pixelTool, setPixelTool] = useState<Tool>('pencil');
  const [axisLock, setAxisLock] = useState({ x: false, y: false, z: false });
  const [mirrorMode, setMirrorMode] = useState({ x: false, z: false });
  const [showGrid, setShowGrid] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [yLayer, setYLayer] = useState(15);
  
  // Library & Pack
  const [library, setLibrary] = useState<SavedDesign[]>(() => loadStorage(STORAGE_KEYS.LIBRARY, []));
  const [collectionName, setCollectionName] = useState(() => loadStorage(STORAGE_KEYS.COLLECTION_NAME, "BitForge Collection"));
  const [tabIcon, setTabIcon] = useState<string[]>(() => loadStorage(STORAGE_KEYS.TAB_ICON, Array(256).fill('transparent')));
  const [showLibrary, setShowLibrary] = useState(false);
  const [namingModal, setNamingModal] = useState<{ voxels: Record<string, Voxel>, isSaveAllRequest?: boolean } | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [selectedInLibrary, setSelectedInLibrary] = useState<Set<string>>(new Set());

  // AI & Feedback
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState({ text: 'Forge Ready', color: 'text-indigo-400' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);

  // Engine Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    instancedMeshes: Map<string, THREE.InstancedMesh>;
    customMeshes: Map<string, THREE.InstancedMesh>;
    ghostMesh: THREE.Mesh;
    grid: THREE.GridHelper;
    contextGroup: THREE.Group;
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
  } | null>(null);

  const prevVoxelRef = useRef<Record<string, Voxel>>({});
  const startPointRef = useRef<THREE.Vector3 | null>(null);


  // --- Actions ---

  const notify = (text: string, color = 'text-indigo-400') => {
    setStatus({ text, color });
    setTimeout(() => setStatus(s => s.text === text ? { ...s, color: 'text-zinc-500' } : s), 3000);
  };

  const pushHistory = useCallback((state: Record<string, Voxel>) => {
    setHistory(prev => [...prev.slice(-49), state]);
    setRedoStack([]);
    setHasUnsavedChanges(true);
  }, []);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const current = voxels;
    const prev = history[history.length - 1];
    setRedoStack(r => [...r, current]);
    setVoxels(prev);
    setHistory(h => h.slice(0, -1));
    notify('Undo performed');
  }, [history, voxels]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const current = voxels;
    const next = redoStack[redoStack.length - 1];
    setHistory(h => [...h, current]);
    setVoxels(next);
    setRedoStack(r => r.slice(0, -1));
    notify('Redo performed');
  }, [redoStack, voxels]);

  // Three.js Initialization
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09090b);

    const camera = new THREE.PerspectiveCamera(45, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
    camera.position.set(20, 20, 20);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(7.5, 7.5, 7.5);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(10, 20, 10);
    scene.add(sun);

    const instancedMeshes = new Map<string, THREE.InstancedMesh>();
    const customMeshes = new Map<string, THREE.InstancedMesh>();
    const geo = new THREE.BoxGeometry(1, 1, 1);

    PRESET_BLOCKS.forEach(b => {
      const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: b.roughness, metalness: b.metalness });
      const imesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
      imesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      imesh.count = 0;
      scene.add(imesh);
      instancedMeshes.set(b.id, imesh);
    });

    const ghostMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#fff', transparent: true, opacity: 0.3 }));
    ghostMesh.visible = false;
    scene.add(ghostMesh);

    const grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, 0x222222, 0x111111);
    grid.position.set(7.5, -0.5, 7.5);
    scene.add(grid);

    const contextGroup = new THREE.Group();
    contextGroup.visible = false;
    scene.add(contextGroup);

    engineRef.current = { scene, camera, renderer, controls, instancedMeshes, customMeshes, ghostMesh, grid, contextGroup, raycaster: new THREE.Raycaster(), mouse: new THREE.Vector2() };

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      if (!containerRef.current || !engineRef.current) return;
      engineRef.current.camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      engineRef.current.camera.updateProjectionMatrix();
      engineRef.current.renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); renderer.dispose(); };
  }, []);

  // Update Meshes
  useEffect(() => {
    if (!engineRef.current) return;
    const { instancedMeshes, customMeshes, scene } = engineRef.current;
    const dummy = new THREE.Object3D();
    const geo = new THREE.BoxGeometry(1, 1, 1);

    const groups: Record<string, Voxel[]> = {};
    const customList: Record<string, Voxel[]> = {};
    (Object.values(voxels) as Voxel[]).forEach(v => {
      if (v.y > yLayer) return;
      if (v.isCustom) { if (!customList[v.block]) customList[v.block] = []; customList[v.block].push(v); }
      else { if (!groups[v.block]) groups[v.block] = []; groups[v.block].push(v); }
    });

    instancedMeshes.forEach((imesh, id) => {
      const list = groups[id] || [];
      (imesh as THREE.InstancedMesh).count = list.length;
      list.forEach((v, i) => {
        dummy.position.set(v.x, v.y, v.z);
        dummy.scale.setScalar(voxelScale);
        dummy.updateMatrix();
        imesh.setMatrixAt(i, dummy.matrix);
      });
      imesh.instanceMatrix.needsUpdate = true;
      imesh.computeBoundingSphere();
    });

    customMeshes.forEach(m => m.count = 0);
    Object.entries(customList).forEach(([color, list]) => {
      let imesh = customMeshes.get(color);
      if (!imesh) {
        imesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }), MAX_INSTANCES);
        scene.add(imesh);
        customMeshes.set(color, imesh);
      }
      imesh.count = list.length;
      list.forEach((v, i) => {
        dummy.position.set(v.x, v.y, v.z);
        dummy.scale.setScalar(voxelScale);
        dummy.updateMatrix();
        imesh!.setMatrixAt(i, dummy.matrix);
      });
      imesh.instanceMatrix.needsUpdate = true;
      imesh.computeBoundingSphere();
    });
  }, [voxels, yLayer, voxelScale]);

  // Shortcut Handlers
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as any).tagName);
      if (isInput) return;

      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); setNamingModal({ voxels }); }
      if (e.ctrlKey && e.key === 'e') { e.preventDefault(); exportSingle(); }
      if (e.ctrlKey && e.key === 'l') { e.preventDefault(); setShowLibrary(!showLibrary); }
      if (e.key === '[') cyclePalette(-1);
      if (e.key === ']') cyclePalette(1);
      if (e.key >= '1' && e.key <= '9') { setSelectedBlock(PRESET_BLOCKS[parseInt(e.key) - 1]?.id || PRESET_BLOCKS[0].id); setIsCustomSelected(false); }
      if (e.key === ' ') { e.preventDefault(); engineRef.current?.controls.reset(); engineRef.current?.controls.target.set(7.5, 7.5, 7.5); }
      if (e.key === 'f') zoomToFit();
      if (e.key === 'g') setShowGrid(!showGrid);
      if (e.key === 'c') setShowContext(!showContext);
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [voxels, history, redoStack, showLibrary, showGrid, showContext]);

  const cyclePalette = (dir: number) => {
    const idx = PRESET_BLOCKS.findIndex(b => b.id === selectedBlock);
    const next = (idx + dir + PRESET_BLOCKS.length) % PRESET_BLOCKS.length;
    setSelectedBlock(PRESET_BLOCKS[next].id);
    setIsCustomSelected(false);
  };

  const zoomToFit = () => {
    if (!engineRef.current || Object.keys(voxels).length === 0) return;
    const { camera, controls } = engineRef.current;
    const box = new THREE.Box3();
    (Object.values(voxels) as Voxel[]).forEach(v => box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z)));
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim / (2 * Math.tan(Math.PI * camera.fov / 360)) + 5;
    
    // Smoothly animate target
    controls.target.copy(center);
    camera.position.set(center.x + distance, center.y + distance, center.z + distance);
    controls.update();
  };

  // Interaction Logic
  const handlePointer = (e: React.PointerEvent) => {
    if (!containerRef.current || !engineRef.current) return;
    const { camera, instancedMeshes, customMeshes, raycaster, mouse, ghostMesh } = engineRef.current;
    
    const rect = containerRef.current.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const meshes = [...Array.from(instancedMeshes.values()) as THREE.InstancedMesh[], ...Array.from(customMeshes.values()) as THREE.InstancedMesh[]].filter(m => (m as THREE.InstancedMesh).count > 0);
    const intersects = raycaster.intersectObjects(meshes);

    const getPos = () => {
      if (intersects.length > 0) {
        const hit = intersects[0];
        const mesh = hit.object as THREE.InstancedMesh;
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(hit.instanceId!, matrix);
        const base = new THREE.Vector3().setFromMatrixPosition(matrix);
        
        if (activeTool === 'eraser' || activeTool === 'eyedropper') return base;
        
        const normal = hit.face?.normal.clone() || new THREE.Vector3(0, 1, 0);
        return base.add(normal).round();
      } else {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5);
        const pt = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, pt)) return new THREE.Vector3(Math.round(pt.x), 0, Math.round(pt.z));
      }
      return null;
    };

    const targetPos = getPos();
    if (targetPos) {
      if (axisLock.x) targetPos.x = 7;
      if (axisLock.y) targetPos.y = 0;
      if (axisLock.z) targetPos.z = 7;
      
      ghostMesh.position.copy(targetPos);
      ghostMesh.visible = true;
      ghostMesh.scale.setScalar(voxelScale);
      (ghostMesh.material as THREE.MeshStandardMaterial).color.set(isCustomSelected ? customColor : PRESET_BLOCKS.find(b => b.id === selectedBlock)?.color || '#fff');
    } else {
      ghostMesh.visible = false;
    }

    if (e.buttons === 1) {
      // Primary Action
      if (targetPos) {
        const vx = Math.round(targetPos.x), vy = Math.round(targetPos.y), vz = Math.round(targetPos.z);
        if (vx < 0 || vx >= 16 || vy < 0 || vy >= 16 || vz < 0 || vz >= 16) return;

        if (activeTool === 'eyedropper') {
          const key = `${vx},${vy},${vz}`;
          if (voxels[key]) {
            const v = voxels[key];
            if (v.isCustom) { setCustomColor(v.block); setIsCustomSelected(true); }
            else { setSelectedBlock(v.block); setIsCustomSelected(false); }
            setActiveTool('pencil');
          }
          return;
        }

        const applyOp = (pos: {x:number, y:number, z:number}) => {
          const key = `${pos.x},${pos.y},${pos.z}`;
          setVoxels(prev => {
            const next = { ...prev };
            if (activeTool === 'eraser') delete next[key];
            else next[key] = { ...pos, block: isCustomSelected ? customColor : selectedBlock, isCustom: isCustomSelected };
            return next;
          });
        };

        const batchApply = (pos: {x:number, y:number, z:number}) => {
          applyOp(pos);
          if (mirrorMode.x) applyOp({ ...pos, x: 15 - pos.x });
          if (mirrorMode.z) applyOp({ ...pos, z: 15 - pos.z });
          if (mirrorMode.x && mirrorMode.z) applyOp({ x: 15 - pos.x, y: pos.y, z: 15 - pos.z });
        };

        if (activeTool === 'pencil' || activeTool === 'eraser') {
          pushHistory(voxels);
          batchApply({ x: vx, y: vy, z: vz });
        } else if (activeTool === 'fill') {
          // 3D Flood Fill
          pushHistory(voxels);
          const startKey = `${vx},${vy},${vz}`;
          const targetBlock = voxels[startKey]?.block;
          const queue = [{x:vx, y:vy, z:vz}];
          const visited = new Set([startKey]);
          const newVoxels = { ...voxels };
          while(queue.length > 0) {
             const p = queue.shift()!;
             const k = `${p.x},${p.y},${p.z}`;
             if (activeTool === 'fill') newVoxels[k] = { ...p, block: isCustomSelected ? customColor : selectedBlock, isCustom: isCustomSelected };
             [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].forEach(d => {
                const np = { x: p.x + d[0], y: p.y + d[1], z: p.z + d[2] };
                const nk = `${np.x},${np.y},${np.z}`;
                if (np.x >= 0 && np.x < 16 && np.y >= 0 && np.y < 16 && np.z >= 0 && np.z < 16 && !visited.has(nk)) {
                  if (voxels[nk]?.block === targetBlock) {
                    visited.add(nk);
                    queue.push(np);
                  }
                }
             });
          }
          setVoxels(newVoxels);
        }
      }
    }
  };

  // Export Logic
  const generateTabIcon = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    tabIcon.forEach((c, i) => {
      if (c === 'transparent') return;
      ctx.fillStyle = c;
      const x = i % 16;
      const y = Math.floor(i / 16);
      ctx.fillRect(x * 2, y * 2, 2, 2);
    });
    return canvas.toDataURL('image/png');
  };

  const exportSingle = () => {
    if (Object.keys(voxels).length === 0) return notify('Grid is empty', 'text-red-400');
    setNamingModal({ voxels });
  };

  const performExport = async (saveToLib = true, designs = [voxels], designNames = [nameInput || 'BitForge Item']) => {
    notify('Assembling .mcaddon...');
    const zip = new JSZip();
    const packUuids = loadStorage(STORAGE_KEYS.UUIDS, { bp: uuid(), rp: uuid(), modBp: uuid(), modRp: uuid() });
    saveStorage(STORAGE_KEYS.UUIDS, packUuids);

    const bp = zip.folder('bitforge_bp')!;
    const rp = zip.folder('bitforge_rp')!;

    bp.file('manifest.json', JSON.stringify({
      format_version: 2,
      header: { name: 'BitForge BP', description: collectionName, uuid: packUuids.bp, version: [1,0,0], min_engine_version: [1,16,0] },
      modules: [{ type: 'data', uuid: packUuids.modBp, version: [1,0,0] }],
      metadata: { authors: ["BitForge AI"] }
    }, null, 2));

    rp.file('manifest.json', JSON.stringify({
      format_version: 2,
      header: { name: 'BitForge RP', description: collectionName, uuid: packUuids.rp, version: [1,0,0], min_engine_version: [1,16,0] },
      modules: [{ type: 'resources', uuid: packUuids.modRp, version: [1,0,0] }],
      metadata: { authors: ["BitForge AI"] }
    }, null, 2));

    const terrainData: any = { resource_pack_name: 'bitforge', texture_data: { bitforge_tab_icon: { textures: 'textures/ui/tab_icon' } } };
    const itemData: any = { resource_pack_name: 'bitforge', texture_data: {} };
    const rpTex = rp.folder('textures/blocks')!;
    const uiTex = rp.folder('textures/ui')!;
    uiTex.file('tab_icon.png', generateTabIcon().split(',')[1], { base64: true });

    designs.forEach((designVoxels, dIdx) => {
      const dName = designNames[dIdx];
      const dId = slugify(dName);
      const voxelList = Object.values(designVoxels) as Voxel[];
      
      const usedBlocks = Array.from(new Set(voxelList.map(v => v.isCustom ? v.block : v.block)));
      usedBlocks.forEach((bid, bIdx) => {
        const texName = `tex_${dId}_${bIdx}`;
        const color = bid.startsWith('#') ? bid : (PRESET_BLOCKS.find(p => p.id === bid)?.color || '#ffffff');
        // Simple procedural texture
        const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = color; ctx.fillRect(0,0,16,16);
        ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(Math.random()*16, Math.random()*16, 1, 1);
        rpTex.file(`${texName}.png`, canvas.toDataURL().split(',')[1], { base64: true });
        terrainData.texture_data[texName] = { textures: `textures/blocks/${texName}` };
      });

      const bones = voxelList.map((v, i) => ({
        name: `v${i}`, parent: 'root', pivot: [(v.x-8)*voxelScale, v.y*voxelScale, (v.z-8)*voxelScale],
        cubes: [{ origin: [(v.x-8)*voxelScale, v.y*voxelScale, (v.z-8)*voxelScale], size:[voxelScale, voxelScale, voxelScale], uv:[0,0] }]
      }));

      rp.folder('models/blocks')!.file(`${dId}.geo.json`, JSON.stringify({
        format_version: '1.12.0',
        'minecraft:geometry': [{
          description: { identifier: `geometry.${dId}`, texture_width: 16, texture_height: 16 },
          bones: [{ name:'root', pivot:[0,0,0] }, ...bones]
        }]
      }, null, 2));

      bp.folder('blocks')!.file(`${dId}.json`, JSON.stringify({
        format_version: '1.16.0',
        'minecraft:block': {
          description: { identifier: `bitforge:${dId}` },
          components: {
            'minecraft:geometry': `geometry.${dId}`,
            'minecraft:material_instances': { '*': { texture: `tex_${dId}_0`, render_method: 'opaque' } },
            'minecraft:menu_category': { category: 'items', group: 'bitforge:furniture_collection' }
          }
        }
      }, null, 2));
    });

    rp.file('textures/terrain_texture.json', JSON.stringify(terrainData, null, 2));

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `${slugify(collectionName)}.mcaddon`;
    link.click();
    notify('Pack exported successfully!', 'text-green-400');
  };

  const saveToLibrary = () => {
    if (!namingModal) return;
    const thumb = engineRef.current?.renderer.domElement.toDataURL() || '';
    const stats = buildStats;
    const newDesign: SavedDesign = {
      id: uuid(),
      name: nameInput || 'New Furniture',
      voxels: namingModal.voxels,
      thumbnail: thumb,
      prompt: prompt,
      timestamp: Date.now(),
      dimensions: { w: stats.w, h: stats.h, d: stats.d },
      voxelCount: Object.keys(namingModal.voxels).length
    };
    const nextLib = [newDesign, ...library].slice(0, 50);
    setLibrary(nextLib);
    saveStorage(STORAGE_KEYS.LIBRARY, nextLib);
    setNamingModal(null);
    setNameInput('');
    notify('Saved to library');
    if (nextLib.length >= 45) notify('Library almost full (max 50)', 'text-yellow-400');
  };

  const handleForge = async () => {
    if (!prompt.trim()) return notify('Please enter a prompt', 'text-red-400');
    
    setIsGenerating(true);
    notify('Igniting the forge...', 'text-indigo-400');
    
    try {
      const resp = await fetch('/api/forge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Forge failed');
      
      const voxelList = data.voxels;
      
      if (Array.isArray(voxelList)) {
        const nextVoxels: Record<string, Voxel> = {};
        voxelList.forEach((v: any) => {
          if (v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') {
            const vx = Math.floor(v.x);
            const vy = Math.floor(v.y);
            const vz = Math.floor(v.z);
            if (vx >= 0 && vx < 16 && vy >= 0 && vy < 16 && vz >= 0 && vz < 16) {
              const key = `${vx},${vy},${vz}`;
              const blockId = v.block || 'stone';
              const isPreset = PRESET_BLOCKS.some(p => p.id === blockId);
              nextVoxels[key] = {
                x: vx,
                y: vy,
                z: vz,
                block: blockId,
                isCustom: !isPreset && String(blockId).startsWith('#')
              };
            }
          }
        });
        
        if (Object.keys(nextVoxels).length === 0) {
          throw new Error('AI returned an empty design');
        }
        
        pushHistory(voxels);
        setVoxels(nextVoxels);
        notify('Design forged successfully!', 'text-green-400');
        
        // Visual confirmation
        setTimeout(() => {
          zoomToFit();
          setIsFlashing(true);
          setTimeout(() => setIsFlashing(false), 800);
        }, 100);
      }
    } catch (err: any) {
      console.error(err);
      notify(err.message, 'text-red-400');
    } finally {
      setIsGenerating(false);
    }
  };

  const buildStats = useMemo(() => {
    if (Object.keys(voxels).length === 0) return { w:0, h:0, d:0, rating:'Empty' };
    const list = Object.values(voxels) as Voxel[];
    const xs = list.map(v => v.x), ys = list.map(v => v.y), zs = list.map(v => v.z);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    const d = Math.max(...zs) - Math.min(...zs) + 1;
    const max = Math.max(w,h,d);
    let r = 'Small Decor';
    if (max > 12) r = 'Monumental';
    else if (max > 8) r = 'Grand Piece';
    else if (max > 4) r = 'Standard Furniture';
    return { w, h, d, rating: r };
  }, [voxels]);

  // Auto-save logic
  useEffect(() => {
    const interval = setInterval(() => {
      saveStorage(STORAGE_KEYS.AUTOSAVE, { voxels, history });
      setHasUnsavedChanges(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [voxels, history]);

  return (
    <div className="flex h-screen w-full flex-col bg-zinc-950 font-sans text-zinc-100 overflow-hidden">
      {/* Top Header */}
      <header className="flex h-14 items-center justify-between border-b border-white/5 bg-zinc-900/60 px-6 backdrop-blur-xl z-50">
        <div className="flex items-center gap-4">
          <button onClick={() => setShowLibrary(!showLibrary)} className={`p-2 rounded transition-all ${showLibrary ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
            <Library size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            <h1 className="text-[10px] font-black uppercase tracking-widest">BitForge <span className="text-zinc-500">v4.0</span></h1>
          </div>
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[8px] font-mono border ${hasUnsavedChanges ? 'border-orange-500/20 text-orange-400' : 'border-green-500/20 text-green-400'}`}>
             <div className={`h-1 w-1 rounded-full ${hasUnsavedChanges ? 'bg-orange-500' : 'bg-green-500'}`} />
             {hasUnsavedChanges ? 'Unsaved Changes' : 'All Changes Saved'}
          </div>
        </div>

        {/* Universal Toolbar */}
        <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-lg border border-white/5">
           {[
             { id: 'pencil', icon: Pencil, label: 'Pencil' },
             { id: 'eraser', icon: Eraser, label: 'Eraser' },
             { id: 'fill', icon: PaintBucket, label: 'Flood Fill' },
             { id: 'eyedropper', icon: Pipette, label: 'Picker' }
           ].map(t => (
             <button 
               key={t.id} 
               onClick={() => setActiveTool(t.id as Tool)}
               className={`p-2 rounded transition-all group relative ${activeTool === t.id ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:bg-white/5'}`}
             >
               <t.icon size={16} />
               <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-zinc-800 text-[8px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{t.label}</span>
             </button>
           ))}
           <div className="w-[1px] h-4 bg-white/10 mx-1" />
           <button onClick={undo} disabled={history.length === 0} className="p-2 rounded text-zinc-500 hover:bg-white/5 disabled:opacity-20 transition-all"><Undo2 size={16} /></button>
           <button onClick={redo} disabled={redoStack.length === 0} className="p-2 rounded text-zinc-500 hover:bg-white/5 disabled:opacity-20 transition-all"><Redo2 size={16} /></button>
           <button onClick={() => { pushHistory(voxels); setVoxels({}); notify('Canvas cleared', 'text-orange-400'); }} className="p-2 rounded text-rose-500 hover:bg-rose-500/10 transition-all"><Trash2 size={16} /></button>
           <button onClick={() => setNamingModal({ voxels })} className="p-2 rounded text-emerald-500 hover:bg-emerald-500/10 transition-all"><Save size={16} /></button>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-zinc-800/50 p-1 rounded">
             <button onClick={() => setAxisLock(l => ({ ...l, x: !l.x }))} className={`px-2 py-1 text-[9px] font-bold rounded ${axisLock.x ? 'bg-red-500 text-white' : 'text-zinc-500'}`}>X</button>
             <button onClick={() => setAxisLock(l => ({ ...l, y: !l.y }))} className={`px-2 py-1 text-[9px] font-bold rounded ${axisLock.y ? 'bg-green-500 text-white' : 'text-zinc-500'}`}>Y</button>
             <button onClick={() => setAxisLock(l => ({ ...l, z: !l.z }))} className={`px-2 py-1 text-[9px] font-bold rounded ${axisLock.z ? 'bg-blue-500 text-white' : 'text-zinc-500'}`}>Z</button>
          </div>
          <button onClick={exportSingle} className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-[10px] font-black uppercase hover:bg-indigo-500 transition-all active:scale-95 shadow-lg shadow-indigo-500/20">
            <Download size={14} /> Export
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Library Sidebar (Slide-in) */}
        <AnimatePresence>
          {showLibrary && (
            <motion.div 
               initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }}
               className="absolute top-0 left-0 bottom-0 w-80 bg-zinc-900 border-r border-white/5 z-40 flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Database size={16} className="text-indigo-400" />
                  <span className="text-xs font-black uppercase tracking-widest">Library</span>
                </div>
                <button onClick={() => setShowLibrary(false)} className="text-zinc-500 hover:text-white"><X size={16} /></button>
              </div>
              <div className="p-4 bg-black/20 flex gap-2">
                 <button onClick={() => performExport(false, library.map(l => l.voxels), library.map(l => l.name))} className="flex-1 py-2 rounded bg-indigo-600 text-[9px] font-bold uppercase tracking-wider">Export All</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {library.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-zinc-600 space-y-2">
                    <Clock size={32} strokeWidth={1} />
                    <p className="text-[10px] uppercase font-bold">No designs saved yet</p>
                  </div>
                ) : library.map(item => (
                  <div key={item.id} className="group relative bg-zinc-800/50 rounded-xl overflow-hidden border border-white/5 hover:border-indigo-500/50 transition-all cursor-pointer" onClick={() => { setVoxels(item.voxels); setPrompt(item.prompt); notify(`Loaded: ${item.name}`); }}>
                    <img src={item.thumbnail} className="w-full aspect-square object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                    <div className="p-3">
                       <p className="text-[10px] font-bold truncate">{item.name}</p>
                       <div className="flex items-center justify-between mt-1 text-[8px] font-mono text-zinc-500">
                         <span>{item.voxelCount} Voxels</span>
                         <span>{item.dimensions.w}x{item.dimensions.h}x{item.dimensions.d}</span>
                       </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setLibrary(l => l.filter(i => i.id !== item.id)); }} className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Canvas Area */}
        <div className={`relative flex-1 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 to-zinc-950 transition-all duration-300 ${isFlashing ? 'ring-2 ring-indigo-500 ring-inset ring-offset-4 ring-offset-zinc-950' : ''}`}>
          <div ref={containerRef} className="h-full w-full" onPointerMove={handlePointer} onPointerDown={handlePointer} onContextMenu={e => e.preventDefault()} />
          
          {/* Overlays */}
          <div className="absolute top-6 left-6 flex flex-col gap-2 pointer-events-none">
             <div className="p-4 bg-zinc-900/80 backdrop-blur border border-white/10 rounded-xl space-y-2 pointer-events-auto shadow-2xl">
                <div className="flex items-center gap-2 text-indigo-400 font-black uppercase text-[9px] tracking-widest"><Move size={14} /> View Controls</div>
                <div className="grid grid-cols-2 gap-2">
                   <button onClick={() => setShowGrid(!showGrid)} className={`flex items-center gap-2 p-2 rounded text-[8px] font-bold uppercase transition-all ${showGrid ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400'}`}><Grid size={12} /> Grid</button>
                   <button onClick={() => setShowContext(!showContext)} className={`flex items-center gap-2 p-2 rounded text-[8px] font-bold uppercase transition-all ${showContext ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400'}`}><User size={12} /> Scene</button>
                </div>
                <button onClick={zoomToFit} className="w-full flex items-center justify-center gap-2 p-2 rounded bg-zinc-800 text-[8px] text-zinc-400 font-bold uppercase hover:bg-zinc-700 transition-all"><Maximize size={12} /> Zoom to Fit <span className="opacity-50">[F]</span></button>
             </div>
          </div>

          <div className="absolute top-6 right-6 flex flex-col gap-2 pointer-events-none">
            <div className="p-4 bg-zinc-900/80 backdrop-blur border border-white/10 rounded-xl space-y-3 pointer-events-auto shadow-2xl">
               <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-indigo-400 font-black uppercase text-[9px] tracking-widest"><Layers size={14} /> Layer Stack</div><span className="text-[9px] font-mono text-zinc-500">{yLayer+1}/16</span></div>
               <input type="range" min="0" max="15" value={yLayer} onChange={e => setYLayer(parseInt(e.target.value))} className="w-40 h-1 bg-zinc-800 rounded-full accent-indigo-500" />
            </div>
            <div className="p-4 bg-zinc-900/80 backdrop-blur border border-white/10 rounded-xl space-y-3 pointer-events-auto shadow-2xl">
               <div className="flex items-center gap-2 text-indigo-400 font-black uppercase text-[9px] tracking-widest"><RotateCcw size={14} /> Mirroring</div>
               <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setMirrorMode(m => ({ ...m, x: !m.x }))} className={`p-2 rounded text-[8px] font-bold uppercase transition-all ${mirrorMode.x ? 'bg-indigo-600' : 'bg-zinc-800 text-zinc-500'}`}>Mirror X</button>
                  <button onClick={() => setMirrorMode(m => ({ ...m, z: !m.z }))} className={`p-2 rounded text-[8px] font-bold uppercase transition-all ${mirrorMode.z ? 'bg-indigo-600' : 'bg-zinc-800 text-zinc-500'}`}>Mirror Z</button>
               </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <aside className="w-80 flex flex-col border-l border-white/5 bg-zinc-900/40 backdrop-blur-3xl overflow-y-auto">
          <div className="p-6 space-y-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 flex items-center gap-2"><Wand2 size={12} /> Forge AI</span></div>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Type a concept, like: 'Victorian Armchair' or 'Neon Dining Table'..." className="w-full h-24 bg-zinc-950/50 border border-white/5 rounded-xl p-4 text-xs focus:ring-1 focus:ring-indigo-500/50 outline-none resize-none placeholder:text-zinc-700" />
              <button 
                onClick={handleForge}
                disabled={isGenerating || !prompt.trim()} 
                className="w-full h-10 rounded-xl bg-indigo-600 font-black uppercase text-[10px] tracking-widest shadow-xl shadow-indigo-600/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {isGenerating ? 'Igniting Forge...' : 'Forging Design'}
              </button>
            </div>

            <div className="space-y-4 pt-4 border-t border-white/5">
              <div className="flex items-center gap-2 text-indigo-400 font-black uppercase text-[10px] tracking-[0.2em]"><Box size={14} /> Palette</div>
              <div className="grid grid-cols-6 gap-2">
                 {PRESET_BLOCKS.map(block => (
                   <button 
                     key={block.id} 
                     onClick={() => { setSelectedBlock(block.id); setIsCustomSelected(false); }}
                     className={`aspect-square rounded-md border-2 transition-all hover:scale-110 shadow-lg ${selectedBlock === block.id && !isCustomSelected ? 'border-white scale-110' : 'border-white/5'}`}
                     style={{ backgroundColor: block.color }}
                     title={block.name}
                   />
                 ))}
                 <button 
                   onClick={() => setIsCustomSelected(true)}
                   className={`aspect-square rounded-md border-2 bg-zinc-800 flex items-center justify-center transition-all ${isCustomSelected ? 'border-white scale-110' : 'border-white/5'}`}
                 >
                   <div className="w-4 h-4 rounded-full" style={{ backgroundColor: customColor }} />
                 </button>
              </div>
            </div>

            {isCustomSelected && (
              <div className="p-4 bg-black/20 rounded-xl border border-white/5 space-y-4">
                 <div className="flex items-center justify-between"><span className="text-[8px] font-black uppercase text-zinc-500">Brush Color</span><span className="text-[8px] font-mono">{customColor}</span></div>
                 <input type="color" value={customColor} onChange={e => setCustomColor(e.target.value)} className="w-full h-8 bg-transparent cursor-pointer" />
              </div>
            )}

            <div className="space-y-4 pt-4 border-t border-white/5">
              <div className="flex items-center gap-2 text-indigo-400 font-black uppercase text-[10px] tracking-[0.2em]"><Settings2 size={14} /> Collection Settings</div>
              <div className="space-y-3">
                 <div className="space-y-1">
                    <p className="text-[8px] font-bold text-zinc-500 uppercase">Tab Name</p>
                    <input value={collectionName} onChange={e => { setCollectionName(e.target.value); saveStorage(STORAGE_KEYS.COLLECTION_NAME, e.target.value); }} className="w-full bg-zinc-800 border-none rounded p-2 text-xs" />
                 </div>
                 <div className="space-y-4">
                    <div className="flex items-center justify-between">
                       <p className="text-[8px] font-bold text-zinc-500 uppercase">Tab Icon (Pixel Art)</p>
                       <div className="flex items-center gap-1 bg-black/40 p-1 rounded border border-white/5">
                          {[
                            { id: 'pencil', icon: Pencil },
                            { id: 'eraser', icon: Eraser },
                            { id: 'fill', icon: PaintBucket },
                            { id: 'eyedropper', icon: Pipette }
                          ].map(t => (
                            <button 
                              key={t.id} 
                              onClick={() => setPixelTool(t.id as Tool)}
                              className={`p-1.5 rounded transition-all ${pixelTool === t.id ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:bg-white/5'}`}
                            >
                              <t.icon size={12} />
                            </button>
                          ))}
                          <div className="w-[1px] h-3 bg-white/10 mx-0.5" />
                          <button onClick={() => { setTabIcon(Array(256).fill('transparent')); notify('Icon cleared', 'text-orange-400'); }} className="p-1.5 rounded text-rose-500 hover:bg-rose-500/10 transition-all"><Trash2 size={12} /></button>
                          <button onClick={() => { saveStorage(STORAGE_KEYS.TAB_ICON, tabIcon); notify('Icon saved', 'text-green-400'); }} className="p-1.5 rounded text-emerald-500 hover:bg-emerald-500/10 transition-all"><Save size={12} /></button>
                       </div>
                    </div>
                    <PixelEditor 
                      value={tabIcon} 
                      onChange={v => { setTabIcon(v); saveStorage(STORAGE_KEYS.TAB_ICON, v); }} 
                      color={customColor} 
                      tool={pixelTool} 
                      onColorPick={(c) => { setCustomColor(c); setIsCustomSelected(true); }}
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-[7px] text-zinc-600 uppercase font-mono">Tool: {pixelTool.toUpperCase()}</p>
                      <button onClick={() => setTabIcon(Array(256).fill(customColor))} className="text-[7px] text-indigo-400 uppercase font-bold hover:underline">Flood Canvas</button>
                    </div>
                 </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Modals */}
      {namingModal && (
        <Modal title="Catalog Design" onClose={() => setNamingModal(null)}>
           <div className="space-y-6">
              <div className="aspect-square w-full rounded-xl bg-zinc-950 border border-white/5 overflow-hidden flex items-center justify-center relative group">
                 <img src={engineRef.current?.renderer.domElement.toDataURL()} className="max-w-full max-h-full object-contain" />
                 <div className="absolute inset-0 bg-indigo-600/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="space-y-2">
                 <p className="text-[8px] font-bold text-zinc-500 uppercase">Block Identifier Name</p>
                 <input 
                    autoFocus 
                    placeholder="e.g. Modern Sofa" 
                    value={nameInput} 
                    onChange={e => setNameInput(e.target.value)} 
                    className="w-full bg-zinc-800 border-none rounded-lg p-4 text-xs font-bold focus:ring-2 focus:ring-indigo-600"
                    onKeyDown={e => { if (e.key === 'Enter') { saveToLibrary(); performExport(); } }}
                 />
              </div>
              <div className="flex gap-3">
                 <button onClick={() => setNamingModal(null)} className="flex-1 py-3 text-[10px] font-bold uppercase text-zinc-500 hover:text-white transition-colors">Cancel</button>
                 <button onClick={() => { saveToLibrary(); performExport(); }} className="flex-1 bg-indigo-600 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500 shadow-xl shadow-indigo-600/20 active:scale-95 transition-all">Export & Save</button>
              </div>
           </div>
        </Modal>
      )}

      {/* Status Footer */}
      <footer className="h-10 border-t border-white/5 bg-zinc-900/80 px-6 flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-widest">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className={`h-1.5 w-1.5 rounded-full ${status.text.includes('failed') ? 'bg-red-500 shadow-[0_0_8px_red]' : 'bg-green-500 shadow-[0_0_8px_#10b981]'}`} />
            <span className={status.color}>{status.text}</span>
          </div>
          <span className="text-zinc-800">|</span>
          <p className="text-zinc-400">Voxels: <span className="text-white">{Object.keys(voxels).length}</span></p>
          <p className="text-zinc-400">Dim: <span className="text-white">{buildStats.w}×{buildStats.h}×{buildStats.d}</span></p>
          <div className="px-2 py-0.5 bg-black/40 rounded border border-white/5 text-indigo-400 flex items-center gap-1.5"><Maximize size={10} strokeWidth={3} /> {buildStats.rating}</div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex gap-4">
             <button onClick={undo} disabled={history.length === 0} className="flex items-center gap-2 text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"><Undo2 size={12} /> {history.length}</button>
             <button onClick={redo} disabled={redoStack.length === 0} className="flex items-center gap-2 text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"><Redo2 size={12} /> {redoStack.length}</button>
          </div>
          <span className="text-zinc-800">|</span>
          <div className="text-zinc-600">BITFORGE CORE v4.0.2</div>
        </div>
      </footer>
    </div>
  );
}
