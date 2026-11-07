export interface CompanionNote {
  id: string;
  fromUserId: string;
  fromNickname: string;
  toUserId?: string;
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
