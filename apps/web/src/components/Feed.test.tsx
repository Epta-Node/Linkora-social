import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Feed } from './Feed';
import type { Post } from './PostCard';
import { fetchIsPaused } from '../lib/api';

jest.mock('../lib/api');

const mockFetchIsPaused = fetchIsPaused as jest.Mock;

const POSTS: Post[] = [
  { id: 1, author: 'GALICE', content: 'first post' },
  { id: 2, author: 'GBOB', content: 'second post' },
];

function renderFeed(props: Partial<React.ComponentProps<typeof Feed>> = {}) {
  return render(<Feed posts={POSTS} {...props} />);
}

describe('Feed', () => {
  beforeEach(() => {
    mockFetchIsPaused.mockReset();
    mockFetchIsPaused.mockResolvedValue(false);
  });

  it('renders skeleton placeholders while loading', () => {
    const { container } = renderFeed({ loading: true });
    expect(container.querySelectorAll('[style*="200px"]')).toHaveLength(3);
  });

  it('renders an empty state when there are no posts', async () => {
    render(<Feed posts={[]} />);
    expect(await screen.findByText('No posts yet')).toBeInTheDocument();
  });

  it('renders a PostCard for every post', () => {
    renderFeed();
    expect(screen.getByText('first post')).toBeInTheDocument();
    expect(screen.getByText('second post')).toBeInTheDocument();
  });

  it('shows the paused banner once the indexer reports the contract is paused', async () => {
    mockFetchIsPaused.mockResolvedValue(true);
    renderFeed();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/temporarily paused/i);
    });
  });

  it('disables writes and refuses to call handlers while paused', async () => {
    mockFetchIsPaused.mockResolvedValue(true);
    const onLike = jest.fn();
    renderFeed({ onLike });

    const likeButton = await screen.findByRole('button', { name: /like/i });
    expect(likeButton).toBeDisabled();

    await userEvent.click(likeButton);
    expect(onLike).not.toHaveBeenCalled();
  });

  it('runs the handler through the pause guard when not paused', async () => {
    const onLike = jest.fn();
    renderFeed({ onLike });

    await userEvent.click(await screen.findByRole('button', { name: /like/i }));

    await waitFor(() => {
      expect(onLike).toHaveBeenCalledWith(1);
    });
  });

  it('marks the post as pending while a guarded write is in flight, then settles', async () => {
    let releaseGuard: (value: boolean) => void = () => {};
    mockFetchIsPaused.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseGuard = resolve;
        })
    );

    const onLike = jest.fn();
    renderFeed({ onLike });

    const likeButton = await screen.findByRole('button', { name: /like/i });
    void userEvent.click(likeButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /liking/i })).toBeDisabled();
    });

    releaseGuard(false);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^like$/i })).not.toBeDisabled();
    });
  });

  it('reflects already-liked posts in the button label', () => {
    renderFeed({ onLike: jest.fn(), likedPosts: new Set([1]) });
    expect(screen.getByRole('button', { name: 'Liked' })).toBeInTheDocument();
  });
});
