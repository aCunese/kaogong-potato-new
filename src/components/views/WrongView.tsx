import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Card, Button, Tag, Modal } from '../common/UIComponents';
import { Camera, Image as ImageIcon, Trash2, Eye, Calendar, BookOpen } from 'lucide-react';
import { WrongRecord } from '../../types';

interface WrongViewProps {
  onOpenImportModal: () => void;
  onOpenDetailModal: (record: WrongRecord) => void;
  onOpenDeleteConfirm: (recordId: string, bookName: string) => void;
}

export const WrongView: React.FC<WrongViewProps> = ({
  onOpenImportModal,
  onOpenDetailModal,
  onOpenDeleteConfirm,
}) => {
  const { state } = useApp();

  // Group wrong records by bookId
  const bookMap = new Map(state.books.map(b => [b.id, b]));
  const groupedWrong = state.books.map(b => {
    const records = state.wrong.filter(w => w.bookId === b.id);
    return {
      book: b,
      records,
    };
  }).filter(group => group.records.length > 0);

  // Also include records where the book might have been deleted
  const orphanRecords = state.wrong.filter(w => !bookMap.has(w.bookId));

  return (
    <div className="space-y-4 pb-24">
      {/* 头部与吉祥物 */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-2xl font-bold text-ink-main">错题照片复盘</h1>
          <p className="text-xs text-ink-muted mt-1">
            按题本归类拍摄的错题与手写解析，常看常新
          </p>
        </div>
        <PotatoSprite pose={3} size={64} />
      </div>

      {/* 顶部操作条 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-muted">
          已归档照片 ({state.wrong.length} 张)
        </span>
        <Button variant="primary" size="sm" onClick={onOpenImportModal}>
          <Camera size={14} />
          从相册上传错题
        </Button>
      </div>

      {/* 列表 */}
      {state.wrong.length === 0 ? (
        <Card className="py-12 text-center bg-paper/80 border-dashed border-line">
          <div className="flex justify-center mb-3">
            <PotatoSprite pose={3} size={84} />
          </div>
          <div className="text-base font-bold text-ink-main mb-1">暂无错题照片</div>
          <p className="text-xs text-ink-muted max-w-[240px] mx-auto mb-4">
            拍照上传做错的题目和复盘思路，随时在大图下回顾
          </p>
          <Button variant="primary" size="md" onClick={onOpenImportModal}>
            <Camera size={16} />
            上传第一批错题
          </Button>
        </Card>
      ) : (
        <div className="space-y-5">
          {groupedWrong.map(({ book, records }) => (
            <div key={book.id} className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-line pb-1.5">
                <div className="flex items-center gap-2">
                  <BookOpen size={15} className="text-sage" />
                  <span className="text-sm font-bold text-ink-main">{book.name}</span>
                  <Tag variant="potato">{book.subject}</Tag>
                </div>
                <span className="text-xs text-ink-muted font-mono">{records.length} 条记录</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {records.map(record => (
                  <Card
                    key={record.id}
                    className="p-2.5 bg-paper border-line flex flex-col justify-between overflow-hidden group hover:border-sage transition-all"
                  >
                    {/* 缩略图区域 */}
                    <div
                      onClick={() => onOpenDetailModal(record)}
                      className="w-full aspect-[4/3] bg-cream/70 rounded-xl overflow-hidden cursor-pointer relative flex items-center justify-center border border-line/60"
                    >
                      {record.image ? (
                        <img
                          src={record.image}
                          alt="错题缩略图"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="text-center p-2 text-ink-muted">
                          <ImageIcon size={28} className="mx-auto text-sage/40 mb-1" />
                          <span className="text-[10px]">演示错题草稿</span>
                        </div>
                      )}
                      <div className="absolute top-1.5 left-1.5">
                        <Tag variant="gray" className="text-[10px] py-0 px-1.5 backdrop-blur-sm bg-paper/80">
                          {record.date}
                        </Tag>
                      </div>
                    </div>

                    {/* 复盘笔记摘要 */}
                    <div className="mt-2 text-xs text-ink-main line-clamp-2 leading-relaxed min-h-[36px]">
                      {record.note || '未填写复盘笔记'}
                    </div>

                    {/* 操作 */}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-line/50 text-xs">
                      <button
                        onClick={() => onOpenDetailModal(record)}
                        className="text-sage font-medium flex items-center gap-1 hover:underline"
                      >
                        <Eye size={12} />
                        查看详情
                      </button>
                      <button
                        onClick={() => onOpenDeleteConfirm(record.id, book.name)}
                        className="text-ink-muted hover:text-alarm p-1"
                        title="删除错题照片"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}

          {/* 孤儿错题照片（原题本已删除） */}
          {orphanRecords.length > 0 && (
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between border-b border-line pb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-ink-muted">原题本已删除归属</span>
                  <Tag variant="gray">已解绑</Tag>
                </div>
                <span className="text-xs text-ink-muted font-mono">{orphanRecords.length} 条</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {orphanRecords.map(record => (
                  <Card key={record.id} className="p-2.5 bg-paper border-line">
                    <div
                      onClick={() => onOpenDetailModal(record)}
                      className="w-full aspect-[4/3] bg-cream/70 rounded-xl overflow-hidden cursor-pointer flex items-center justify-center"
                    >
                      {record.image ? (
                        <img src={record.image} alt="错题大图" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon size={28} className="text-sage/40" />
                      )}
                    </div>
                    <div className="mt-2 text-xs text-ink-muted truncate">{record.note || '无复盘原因'}</div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
