import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Feed } from './Feed';
import type { Post } from './PostCard';

// Mock the fetchIsPaused function
const mockFetchIsPaused = jest.fn();
jest.mock('../lib/api', () => ({
  fetchIsPaused: mockFetchIsPaused,
}));

const mockPost: Post = {
  id: '1',
  author: 'test-author',
  content: 'Test content',
  likes: [],
  tips: [],
  created_at: '2024-01-01T00:00:00Z',
};

describe('Feed Component', () => {
  beforeEach(() => {
    mockFetchIsPaused.mockResolvedValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should render only one set of like/tip buttons per post', async () => {
    const mockOnLike = jest.fn();
    const mockOnTip = jest.fn();
    
    render(
      <Feed
        posts={[mockPost]}
        onLike={mockOnLike}
        onTip={mockOnTip}
        likedPosts={new Set()}
      />
    );
    
    await waitFor(() => {
      // Should only have one like button and one tip button per post
      const likeButtons = screen.getAllByLabelText(/like post/i);
      const tipButtons = screen.getAllByLabelText(/tip creator/i);
      
      expect(likeButtons).toHaveLength(1);
      expect(tipButtons).toHaveLength(1);
    });
  });

  it('should properly wire callbacks with correct arguments', async () => {
    const mockOnLike = jest.fn();
    const mockOnTip = jest.fn();
    
    render(
      <Feed
        posts={[mockPost]}
        onLike={mockOnLike}
        onTip={mockOnTip}
        likedPosts={new Set()}
      />
    );
    
    await waitFor(() => {
      const likeButton = screen.getByLabelText(/like post/i);
      const tipButton = screen.getByLabelText(/tip creator/i);
      
      // Click like button
      fireEvent.click(likeButton);
      expect(mockOnLike).toHaveBeenCalledWith(1); // post id as number
      
      // Click tip button
      fireEvent.click(tipButton);
      expect(mockOnTip).toHaveBeenCalledWith(1); // post id as number
    });
  });

  it('should disable buttons when contract is paused', async () => {
    mockFetchIsPaused.mockResolvedValue(true);
    const mockOnLike = jest.fn();
    const mockOnTip = jest.fn();
    
    render(
      <Feed
        posts={[mockPost]}
        onLike={mockOnLike}
        onTip={mockOnTip}
        likedPosts={new Set()}
      />
    );
    
    await waitFor(() => {
      const likeButton = screen.getByLabelText(/like post/i);
      const tipButton = screen.getByLabelText(/tip creator/i);
      
      expect(likeButton).toBeDisabled();
      expect(tipButton).toBeDisabled();
    });
  });

  it('should show pause banner when contract is paused', async () => {
    mockFetchIsPaused.mockResolvedValue(true);
    
    render(
      <Feed
        posts={[mockPost]}
        onLike={jest.fn()}
        onTip={jest.fn()}
        likedPosts={new Set()}
      />
    );
    
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Linkora is temporarily paused. Writes are disabled until the protocol resumes.'
      );
    });
  });
});
