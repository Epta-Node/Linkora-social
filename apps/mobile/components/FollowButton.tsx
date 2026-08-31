import React, { useEffect } from 'react';
import { 
  TouchableOpacity, 
  Text, 
  StyleSheet, 
  ActivityIndicator, 
  Alert 
} from 'react-native';
import { useFollow } from '../hooks/useFollow';

interface FollowButtonProps {
  targetAddress: string;
}

/**
 * FollowButton component for the Linkora mobile app.
 * Implements optimistic UI updates and handles contract-level blocking.
 */
export const FollowButton: React.FC<FollowButtonProps> = ({ targetAddress }) => {
  const { isFollowing, isLoading, toggleFollow, error } = useFollow(targetAddress);

  useEffect(() => {
    if (error) {
      const isBlocked = error.message.toLowerCase().includes('blocked');
      Alert.alert(
        "Action Failed",
        isBlocked 
          ? "You cannot follow this user because you have been blocked." 
          : "Something went wrong. Please try again later."
      );
    }
  }, [error]);

  return (
    <TouchableOpacity 
      style={[
        styles.button, 
        isFollowing ? styles.followingButton : styles.followButton
      ]} 
      onPress={toggleFollow}
      disabled={isLoading}
      activeOpacity={0.7}
    >
      {isLoading ? (
        <ActivityIndicator color={isFollowing ? "#7C3AED" : "#FFFFFF"} size="small" />
      ) : (
        <Text style={[styles.text, isFollowing && styles.followingText]}>
          {isFollowing ? 'Following' : 'Follow'}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followButton: {
    backgroundColor: '#7C3AED', // Primary design token
  },
  followingButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#7C3AED',
  },
  text: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  followingText: {
    color: '#7C3AED',
  },
});