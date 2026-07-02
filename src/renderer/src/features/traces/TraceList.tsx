import { Clock, GitBranch, HelpCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CreativeTrace } from './traceTypes';

type TraceListProps = {
  traces: CreativeTrace[];
  editingTraceId: string | null;
  editingTitle: string;
  onCreateTrace: () => void;
  onOpenTrace: (id: string) => void;
  onStartRename: (trace: CreativeTrace) => void;
  onEditingTitleChange: (value: string) => void;
  onFinishRename: (id: string) => void;
  onCancelRename: () => void;
  onDeleteTrace: (trace: CreativeTrace) => void;
};

function formatTraceTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function TraceList({
  traces,
  editingTraceId,
  editingTitle,
  onCreateTrace,
  onOpenTrace,
  onStartRename,
  onEditingTitleChange,
  onFinishRename,
  onCancelRename,
  onDeleteTrace
}: TraceListProps): JSX.Element {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-[#e6eae5] px-7 py-6 dark:bg-[#252525]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-[-0.01em] text-stone-800 dark:text-neutral-100">创作复迹</h2>
            <div className="group relative">
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition hover:bg-[#dce2dc] hover:text-stone-600 focus:bg-[#dce2dc] focus:text-stone-600 focus:outline-none dark:text-neutral-500 dark:hover:bg-[#393939] dark:hover:text-neutral-200 dark:focus:bg-[#393939] dark:focus:text-neutral-200"
                aria-label="查看创作复迹操作方法"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute left-0 top-8 z-30 w-[300px] rounded-[12px] border border-[#d7ddd6] bg-[#fbfbfa] p-3 text-left text-xs leading-6 text-stone-600 opacity-0 shadow-[0_18px_42px_rgba(23,32,28,0.13)] transition group-hover:opacity-100 group-focus-within:opacity-100 dark:border-[#464646] dark:bg-[#303030] dark:text-neutral-300 dark:shadow-[0_18px_42px_rgba(0,0,0,0.28)]">
                <p>双击空白处：新建文字节点</p>
                <p>拖入图片：添加图片节点</p>
                <p>插入作品：添加作品节点</p>
                <p>拖动节点右侧圆点：创建连接线</p>
                <p>框选拖拽：多选并移动节点</p>
                <p>Ctrl+Z：撤回</p>
                <p>Ctrl+Shift+Z：恢复</p>
                <p>Ctrl+滚轮：缩放画布</p>
                <p>空格键+按鼠标左键拖拽：移动画布</p>
                <p>导出：导出当前复迹为 PNG</p>
              </div>
            </div>
          </div>
          <p className="mt-1 text-sm text-stone-500 dark:text-neutral-400">用节点画布整理生成思路，复盘你的 AI 视觉创作过程</p>
        </div>
        {traces.length > 0 && (
          <button className="primary-button" onClick={onCreateTrace}>
            <Plus className="h-4 w-4" />
            新建
          </button>
        )}
      </div>

      {traces.length === 0 ? (
        <div className="flex min-h-[520px] items-center justify-center">
          <div className="w-full max-w-md px-8 py-10 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[16px] bg-[#e8f1ea] text-[#5f7f69] dark:bg-[#383838] dark:text-neutral-300">
              <GitBranch className="h-7 w-7" />
            </div>
            <h3 className="text-lg font-semibold tracking-[-0.01em]">还没有创作复迹</h3>
            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-neutral-400">新建一张复迹图，记录并复盘你的 AI 视觉生成过程</p>
            <div className="mt-5 flex justify-center">
              <button className="primary-button" onClick={onCreateTrace}>
                <Plus className="h-4 w-4" />
                新建
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {traces.map((trace) => {
            const isEditing = editingTraceId === trace.id;
            return (
              <article
                key={trace.id}
                className="group flex min-h-[164px] flex-col rounded-[8px] border border-[#d8ddd7]/85 bg-[#fbfbfa] p-4 shadow-[0_12px_30px_rgba(23,32,28,0.05)] transition hover:-translate-y-0.5 hover:border-[#c7d0c5] hover:bg-white dark:border-[#3f3f3f] dark:bg-[#303030] dark:shadow-none dark:hover:border-[#565656] dark:hover:bg-[#343434]"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => onOpenTrace(trace.id)}>
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#eef1ec] text-[#5f7f69] dark:bg-[#3a3a3a] dark:text-neutral-300">
                      <GitBranch className="h-5 w-5" />
                    </div>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <button className="icon-button" onClick={() => onStartRename(trace)} aria-label="重命名复迹" title="重命名复迹">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button className="icon-button text-[#9d5147] dark:text-[#d9a19a]" onClick={() => onDeleteTrace(trace)} aria-label="删除复迹" title="删除复迹">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <input
                    className="field-input mb-2"
                    autoFocus
                    value={editingTitle}
                    onChange={(event) => onEditingTitleChange(event.target.value)}
                    onBlur={() => onFinishRename(trace.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onFinishRename(trace.id);
                      if (event.key === 'Escape') onCancelRename();
                    }}
                  />
                ) : (
                  <button className="min-w-0 text-left" onClick={() => onOpenTrace(trace.id)} onDoubleClick={() => onStartRename(trace)}>
                    <h3 className="truncate text-base font-semibold text-stone-800 dark:text-neutral-100">{trace.title}</h3>
                  </button>
                )}

                <button className="mt-2 flex flex-1 flex-col items-start text-left" onClick={() => onOpenTrace(trace.id)}>
                  <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-neutral-400">
                    <Clock className="h-3.5 w-3.5" />
                    更新于 {formatTraceTime(trace.updatedAt)}
                  </span>
                  <span className="mt-1 text-xs text-stone-400 dark:text-neutral-500">创建于 {formatTraceTime(trace.createdAt)}</span>
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
