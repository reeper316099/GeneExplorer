// 3D structure viewer (3Dmol.js, bundled locally and loaded on demand). It only ever receives structure text the
// app fetched itself; nothing is requested from inside this module.
import type { GLViewer } from '3dmol';

/** AlphaFold's standard per-residue confidence colours. */
export function plddtColor(plddt: number): string {
  if (plddt > 90) return '#0053D6';
  if (plddt > 70) return '#65CBF3';
  if (plddt > 50) return '#FFDB13';
  return '#FF7D45';
}

const PLAIN = '#7a8da3';
const HIGHLIGHT = '#E11D74';

export interface ViewerEvents {
  /** Called when the user clicks a residue in the 3D view. */
  onResidueClick: (residue: number) => void;
}

interface AtomLike {
  resi: number;
  resn: string;
  chain: string;
  b: number;
}

export class StructureViewer {
  private viewer: GLViewer | null = null;
  private mode: 'plddt' | 'plain' = 'plddt';
  private highlighted: { start: number; end: number } | null = null;
  private spinning = false;
  private readonly tip: HTMLDivElement;

  /** Creates the viewer inside `container` (which must already be in the document and have a size). */
  constructor(
    private readonly container: HTMLElement,
    private readonly events: ViewerEvents,
  ) {
    this.tip = document.createElement('div');
    this.tip.className = 'v3d-tip';
    this.tip.setAttribute('role', 'status');
    Object.assign(this.tip.style, {
      position: 'absolute',
      pointerEvents: 'none',
      display: 'none',
      background: 'rgba(18,38,63,0.92)',
      color: '#fff',
      padding: '3px 8px',
      borderRadius: '6px',
      fontSize: '12px',
      zIndex: '5',
    });
  }

  /** Loads the 3Dmol library (once) and shows the PDB text; throws a readable Error if WebGL is unavailable. */
  async load(pdb: string): Promise<void> {
    const lib = await import('3dmol');
    this.dispose();
    try {
      this.viewer = lib.createViewer(this.container, { backgroundColor: 'white', antialias: true });
    } catch (e) {
      throw new Error(
        `The 3D view needs WebGL, which is not available here (${e instanceof Error ? e.message : 'unknown error'}).`,
        { cause: e },
      );
    }
    this.container.parentElement?.append(this.tip);
    this.viewer.addModel(pdb, 'pdb');
    this.applyStyle();
    this.viewer.setHoverable(
      {},
      true,
      (atom: AtomLike) => {
        this.tip.textContent = `${atom.resn} ${atom.resi} (chain ${atom.chain}) · pLDDT ${atom.b.toFixed(1)}`;
        this.tip.style.display = 'block';
        this.tip.style.left = '10px';
        this.tip.style.top = '10px';
      },
      () => {
        this.tip.style.display = 'none';
      },
    );
    this.viewer.setClickable({}, true, (atom: AtomLike) => this.events.onResidueClick(atom.resi));
    this.viewer.zoomTo();
    this.viewer.render();
  }

  /** Re-applies the cartoon colouring and the current highlight. */
  private applyStyle(): void {
    const v = this.viewer;
    if (!v) return;
    v.setStyle(
      {},
      {
        cartoon: this.mode === 'plddt' ? { colorfunc: (a: AtomLike) => plddtColor(a.b) } : { color: PLAIN },
      },
    );
    if (this.highlighted) {
      v.setStyle(
        { resi: [`${this.highlighted.start}-${this.highlighted.end}`] },
        { cartoon: { color: HIGHLIGHT }, stick: { color: HIGHLIGHT, radius: 0.22 } },
      );
    }
    v.render();
  }

  /** Switches between pLDDT colouring and a single plain colour. */
  setColorMode(mode: 'plddt' | 'plain'): void {
    this.mode = mode;
    this.applyStyle();
  }

  /** Highlights residues (1-based, inclusive) in magenta, or clears with null. */
  highlight(range: { start: number; end: number } | null): void {
    this.highlighted = range;
    this.applyStyle();
    if (range && this.viewer) this.viewer.center({ resi: [`${range.start}-${range.end}`] });
    this.viewer?.render();
  }

  /** Calls `cb` whenever the user rotates or zooms; used to keep two viewers in step. */
  onViewChange(cb: (view: number[]) => void): void {
    this.viewer?.setViewChangeCallback((v: unknown) => cb(v as number[]));
  }

  /** Current view as 3Dmol's array: [x, y, z, zoom, qx, qy, qz, qw]. */
  getView(): number[] {
    return (this.viewer?.getView() ?? []) as number[];
  }

  /** Applies only the ROTATION of another viewer's view (indices 4-7), so each structure keeps its own centre and zoom. */
  syncRotationFrom(view: number[]): void {
    const mine = this.getView();
    if (mine.length < 8 || view.length < 8) return;
    this.viewer?.setView([...mine.slice(0, 4), ...view.slice(4, 8)], true);
  }

  /** Resets rotation and zoom. */
  reset(): void {
    this.viewer?.zoomTo();
    this.viewer?.render();
  }

  /** Starts or stops slow rotation; returns the new state. */
  toggleSpin(): boolean {
    this.spinning = !this.spinning;
    this.viewer?.spin(this.spinning ? 'y' : false, 0.6);
    return this.spinning;
  }

  /** Asks the browser to show the viewer full screen. */
  fullscreen(): void {
    void this.container.parentElement?.requestFullscreen().then(() => this.viewer?.resize());
  }

  /** Re-fits the canvas after its container changed size. */
  resize(): void {
    this.viewer?.resize();
    this.viewer?.render();
  }

  /** Returns the current view as base64 PNG data (no data: prefix), or null when nothing is shown. */
  png(): string | null {
    const uri = this.viewer?.pngURI();
    return uri ? uri.replace(/^data:image\/png;base64,/, '') : null;
  }

  /** Releases the WebGL context and models. */
  dispose(): void {
    if (this.viewer) {
      this.viewer.spin(false);
      this.viewer.clear();
    }
    this.viewer = null;
    this.spinning = false;
  }
}
