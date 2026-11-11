export interface CompanionNote {
  id: string;
  fromUserId: string;
  fromNickname: string;
  fromAvatar?: string;
  toUserId?: string;
  toNickname?: string;
  toAvatar?: string;
  grantId?: string;
  message: string;
  imageUrl?: string;
  hearts: number;
  createdAt: string;
}

export interface CreateCompanionNoteInput {
  toUserId?: string;
  grantId?: string;
  message: string;
  imageUrl?: string;
}
